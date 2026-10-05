package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Profile -> Text size: the percentage each choice gives the app's text. */
public class TextSizeLevelTest {

    @Test
    public void presets_haveFixedPercentages() {
        assertEquals(85,  TextSizeLevel.percentFor("small"));
        assertEquals(100, TextSizeLevel.percentFor("normal"));
        assertEquals(115, TextSizeLevel.percentFor("large"));
    }

    @Test
    public void unknownMissingOrRetiredLevel_fallsBackToNormal() {
        assertEquals(TextSizeLevel.NORMAL, TextSizeLevel.normalize(null));
        assertEquals(TextSizeLevel.NORMAL, TextSizeLevel.normalize(""));
        assertEquals(TextSizeLevel.NORMAL, TextSizeLevel.normalize("huge"));
        assertEquals(TextSizeLevel.NORMAL, TextSizeLevel.normalize("phone"));
        assertEquals(100, TextSizeLevel.percentFor("phone"));
    }
}
