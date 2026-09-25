package com.scoopfamily.familyguard;

import android.app.Activity;
import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.util.Size;
import android.view.Surface;
import android.view.WindowManager;

import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * Takes ONE front-camera photo after repeated wrong screen-lock attempts, then
 * closes itself. Experimental, and opt-in: started only by AntiTheft, only when
 * the owner switched the photo on and granted camera and display-over-apps.
 *
 * Why an Activity and not a service: since Android 10 an app cannot open the
 * camera from the background. A visible (here transparent, over the lock
 * screen) Activity is what the platform allows; display-over-apps is what lets
 * it be started from a receiver. On some phones and ROMs this is still blocked,
 * which is why the feature is labelled experimental — the alert itself does not
 * depend on it.
 *
 * Gives up after TIMEOUT_MS whatever happens: it must never sit on the screen.
 */
public class IntruderCaptureActivity extends Activity {

    static final String EXTRA_GROUP = "group";

    private static final String TAG = "AntiTheft";
    private static final long TIMEOUT_MS = 8000L;
    /** Let auto-exposure settle; a frame straight after opening is usually black. */
    private static final long WARMUP_MS = 900L;

    private HandlerThread thread;
    private Handler handler;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    // Not shown anywhere: a preview target lets auto-exposure settle before the still.
    private SurfaceTexture dummyTexture;
    private Surface previewSurface;
    private String group;
    private boolean done = false;
    private int sensorOrientation = 270;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        group = getIntent().getStringExtra(EXTRA_GROUP);
        if (group == null) { finish(); return; }
        try {
            setShowWhenLocked(true);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        } catch (Throwable ignored) {}

        thread = new HandlerThread("intruder-cam");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.postDelayed(() -> { Log.w(TAG, "camera timed out"); finishQuietly(); }, TIMEOUT_MS);
        handler.post(this::openFront);
    }

    private void openFront() {
        try {
            CameraManager cm = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            String id = null;
            Size size = new Size(640, 480);
            for (String cid : cm.getCameraIdList()) {
                CameraCharacteristics cc = cm.getCameraCharacteristics(cid);
                Integer facing = cc.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                    id = cid;
                    Integer so = cc.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    if (so != null) sensorOrientation = so;
                    StreamConfigurationMap map = cc.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    if (map != null) size = pickSize(map.getOutputSizes(ImageFormat.JPEG), size);
                    break;
                }
            }
            if (id == null) { Log.w(TAG, "no front camera"); finishQuietly(); return; }

            reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.JPEG, 1);
            reader.setOnImageAvailableListener(r -> {
                Image img = null;
                try {
                    img = r.acquireLatestImage();
                    if (img == null || done) return;
                    ByteBuffer buf = img.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buf.remaining()];
                    buf.get(bytes);
                    done = true;
                    Log.i(TAG, "photo taken " + bytes.length + " bytes");
                    AntiTheft.uploadPhoto(getApplicationContext(), group, bytes);
                } finally {
                    if (img != null) img.close();
                    finishQuietly();
                }
            }, handler);

            cm.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice c) { camera = c; startSession(); }
                @Override public void onDisconnected(CameraDevice c) { c.close(); finishQuietly(); }
                @Override public void onError(CameraDevice c, int e) { Log.w(TAG, "camera error " + e); c.close(); finishQuietly(); }
            }, handler);
        } catch (SecurityException | CameraAccessException e) {
            Log.w(TAG, "camera unavailable: " + e.getMessage());
            finishQuietly();
        }
    }

    /** The largest JPEG size not above ~1 megapixel: enough to recognise a face, small to send. */
    private static Size pickSize(Size[] sizes, Size fallback) {
        if (sizes == null || sizes.length == 0) return fallback;
        Size best = null;
        for (Size s : sizes) {
            long px = (long) s.getWidth() * s.getHeight();
            if (px <= 1_100_000L && (best == null || px > (long) best.getWidth() * best.getHeight())) best = s;
        }
        return best != null ? best : fallback;
    }

    private void startSession() {
        try {
            dummyTexture = new SurfaceTexture(10);
            dummyTexture.setDefaultBufferSize(640, 480);
            previewSurface = new Surface(dummyTexture);
            camera.createCaptureSession(Arrays.asList(previewSurface, reader.getSurface()),
                new CameraCaptureSession.StateCallback() {
                    @Override public void onConfigured(CameraCaptureSession s) {
                        session = s;
                        try {
                            CaptureRequest.Builder preview = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                            preview.addTarget(previewSurface);
                            preview.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                            s.setRepeatingRequest(preview.build(), null, handler);
                            handler.postDelayed(IntruderCaptureActivity.this::capture, WARMUP_MS);
                        } catch (Exception e) {
                            Log.w(TAG, "preview failed: " + e.getMessage());
                            finishQuietly();
                        }
                    }
                    @Override public void onConfigureFailed(CameraCaptureSession s) {
                        Log.w(TAG, "camera session failed");
                        finishQuietly();
                    }
                }, handler);
        } catch (Exception e) {
            Log.w(TAG, "camera session error: " + e.getMessage());
            finishQuietly();
        }
    }

    private void capture() {
        try {
            if (camera == null || session == null || done) return;
            CaptureRequest.Builder still = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            still.addTarget(reader.getSurface());
            still.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation);
            still.set(CaptureRequest.JPEG_QUALITY, (byte) 80);
            session.capture(still.build(), null, handler);
        } catch (Exception e) {
            Log.w(TAG, "capture failed: " + e.getMessage());
            finishQuietly();
        }
    }

    private void finishQuietly() {
        runOnUiThread(() -> { if (!isFinishing()) finish(); });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { if (session != null) session.close(); } catch (Exception ignored) {}
        try { if (camera != null) camera.close(); } catch (Exception ignored) {}
        try { if (reader != null) reader.close(); } catch (Exception ignored) {}
        try { if (previewSurface != null) previewSurface.release(); } catch (Exception ignored) {}
        try { if (dummyTexture != null) dummyTexture.release(); } catch (Exception ignored) {}
        if (thread != null) thread.quitSafely();
    }
}
