package com.scoopfamily.familyguard;

/**
 * How big the app's text is, as a person chooses it in Profile -> Settings -> Text size.
 *
 * The app is laid out for a phone at its normal text size. A phone set to a large
 * system font makes the WebView scale every piece of text with it, so words wrap
 * and the cards look cramped. This lets the person pick the size for Kinest alone,
 * without changing the rest of their phone.
 *
 * No Android types, so the mapping can be unit tested.
 */
final class TextSizeLevel {

    private TextSizeLevel() {}

    static final String SMALL  = "small";
    static final String NORMAL = "normal";
    static final String LARGE  = "large";

    /**
     * Normal (shown as "Default") is the default: the layout is built for it, and it
     * ignores the phone's own font size, which is what wrapped on some phones.
     */
    static final String DEFAULT = NORMAL;

    /** Anything unrecognised, including the retired "phone" choice, becomes the default. */
    static String normalize(String level) {
        if (SMALL.equals(level) || NORMAL.equals(level) || LARGE.equals(level)) {
            return level;
        }
        return DEFAULT;
    }

    /** The WebView text zoom, in percent, for a level. */
    static int percentFor(String level) {
        switch (normalize(level)) {
            case SMALL:  return 85;
            case LARGE:  return 115;
            default:     return 100;
        }
    }
}
