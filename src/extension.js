import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const DBUS_INTERFACE_XML = `
<node>
  <interface name="org.gnome.Shell.Extensions.MaximizedByDefault">
    <method name="GetOpenWindows">
      <arg type="s" direction="out" name="windows_json"/>
    </method>
  </interface>
</node>`;

export default class MaximizedByDefaultExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(DBUS_INTERFACE_XML).interfaces[0];
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/MaximizedByDefault');

        global.display.connectObject('window-created', (display, window) => {
            window?.connectObject('shown', window => {
                window?.disconnectObject(this);
                if (window?.get_window_type() !== Meta.WindowType.NORMAL)
                    return;
                if (this._settings.get_strv('excluded-apps').includes(window.get_wm_class()))
                    return;

                const doMaximize = () => {
                    if (window.can_maximize()) {
                        const [major] = Config.PACKAGE_VERSION.split('.');
                        if (parseInt(major) >= 47)
                            window.maximize();
                        else
                            window.maximize(Meta.MaximizeFlags.BOTH);
                    }
                };

                // First attempt: next idle tick (sufficient for most apps).
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    doMaximize();
                    return GLib.SOURCE_REMOVE;
                });

                // Electron/Flatpak apps restore their own saved window state after startup,
                // undoing the first maximize. Re-maximize if needed after a short delay.
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                    try {
                        if (!window.get_maximized())
                            doMaximize();
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        }, this);
    }

    GetOpenWindows() {
        const windows = global.display.list_all_windows()
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL && w.can_maximize())
            .map(w => ({ wmClass: w.get_wm_class() ?? '', title: w.get_title() ?? '' }))
            .filter(w => w.wmClass);
        return JSON.stringify(windows);
    }

    disable() {
        global.display.disconnectObject(this);
        this._dbusImpl.unexport();
        this._dbusImpl = null;
        this._settings = null;
    }
}
