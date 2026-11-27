package io.github.maxkuhnde.notenpult;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.view.KeyEvent;

import org.junit.Test;

/** Volume, media and camera keys get the names remote.js assigns by default. */
public class HardwareKeysTest {
    @Test
    public void selfieShuttersAndRings() {
        assertEquals("AudioVolumeUp", HardwareKeys.webKey(KeyEvent.KEYCODE_VOLUME_UP));
        assertEquals("AudioVolumeDown", HardwareKeys.webKey(KeyEvent.KEYCODE_VOLUME_DOWN));
        assertEquals("Camera", HardwareKeys.webKey(KeyEvent.KEYCODE_CAMERA));
    }

    @Test
    public void mediaKeys() {
        assertEquals("MediaTrackNext", HardwareKeys.webKey(KeyEvent.KEYCODE_MEDIA_NEXT));
        assertEquals("MediaTrackPrevious", HardwareKeys.webKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS));
        assertEquals("MediaPlayPause", HardwareKeys.webKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        assertEquals("MediaPlayPause", HardwareKeys.webKey(KeyEvent.KEYCODE_HEADSETHOOK));
    }

    @Test
    public void pedalKeysAndBackStayWithTheWebView() {
        assertNull(HardwareKeys.webKey(KeyEvent.KEYCODE_PAGE_DOWN));
        assertNull(HardwareKeys.webKey(KeyEvent.KEYCODE_DPAD_RIGHT));
        assertNull(HardwareKeys.webKey(KeyEvent.KEYCODE_ENTER));
        assertNull(HardwareKeys.webKey(KeyEvent.KEYCODE_BACK));
    }
}
