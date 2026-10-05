package com.scoopfamily.familyguard;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/** Family tab -> bell: reads the notification history that NotificationLog keeps. */
@CapacitorPlugin(name = "NotificationLog")
public class NotificationLogPlugin extends Plugin {

    @PluginMethod
    public void getAll(PluginCall call) {
        List<NotificationLogRules.Entry> list = NotificationLog.all(getContext());
        long seenAt = NotificationLog.seenAt(getContext());
        JSArray items = new JSArray();
        for (NotificationLogRules.Entry e : list) {
            JSObject o = new JSObject();
            o.put("t", e.t);
            o.put("type", e.type);
            o.put("title", e.title);
            o.put("body", e.body);
            o.put("route", e.route);
            items.put(o);
        }
        JSObject r = new JSObject();
        r.put("items", items);
        r.put("seenAt", seenAt);
        call.resolve(r);
    }

    @PluginMethod
    public void getUnreadCount(PluginCall call) {
        JSObject r = new JSObject();
        r.put("count", NotificationLog.unread(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void markAllSeen(PluginCall call) {
        NotificationLog.markAllSeen(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationLog.clear(getContext());
        call.resolve();
    }
}
