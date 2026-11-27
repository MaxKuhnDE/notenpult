package io.github.maxkuhnde.notenpult;

import android.view.KeyEvent;

/**
 * Keys of remotes that the WebView does not pass on to the page – volume, media and camera keys
 * (selfie shutters, scroll rings, pedals set to "Volume up" …). MainActivity takes them while the
 * viewer asks for them and hands them over under the names a keydown event would have
 * (renderer/js/remote.js). Pedal keys such as Page Down or arrows reach the page directly.
 */
final class HardwareKeys {
    private HardwareKeys() {
    }

    /** Key name as in a keydown event, or null for keys the system or the WebView keep. */
    static String webKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_VOLUME_UP:
                return "AudioVolumeUp";
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                return "AudioVolumeDown";
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                return "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return "MediaTrackPrevious";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "MediaPause";
            case KeyEvent.KEYCODE_CAMERA:
            case KeyEvent.KEYCODE_FOCUS:
                return "Camera";
            default:
                return null;
        }
    }
}
