package com.scoopfamily.familyguard;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The bar rules behind the family card's signal icon. */
public class NetworkSignalTest {

    @Test public void wifiBreakpoints() {
        assertEquals(4, NetworkSignal.wifiBars(-40));
        assertEquals(4, NetworkSignal.wifiBars(-55));
        assertEquals(3, NetworkSignal.wifiBars(-56));
        assertEquals(3, NetworkSignal.wifiBars(-66));
        assertEquals(2, NetworkSignal.wifiBars(-67));
        assertEquals(2, NetworkSignal.wifiBars(-77));
        assertEquals(1, NetworkSignal.wifiBars(-78));
        assertEquals(1, NetworkSignal.wifiBars(-88));
        assertEquals(0, NetworkSignal.wifiBars(-89));
        assertEquals(0, NetworkSignal.wifiBars(-120));
    }

    @Test public void cellularLevelPassesThroughInRange() {
        for (int i = 0; i <= 4; i++) assertEquals(i, NetworkSignal.clampBars(i));
    }

    @Test public void cellularLevelOutOfRangeIsUnknown() {
        assertEquals(-1, NetworkSignal.clampBars(-1));
        assertEquals(-1, NetworkSignal.clampBars(5));
        assertEquals(-1, NetworkSignal.clampBars(Integer.MAX_VALUE));
    }
}
