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
    <method name="GetRecentWindows">
      <arg type="s" direction="out" name="windows_json"/>
    </method>
  </interface>
</node>`;

export default class MaximizedByDefaultExtension extends Extension {
    enable() {
        this._recentWindows = [];
        this._settings = this.getSettings();

        const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(DBUS_INTERFACE_XML).interfaces[0];
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/MaximizedByDefault');

        global.display.connectObject('window-created', (display, window) => {
            window?.connectObject('shown', window => {
                window?.disconnectObject(this);
                if (window?.get_window_type() !== Meta.WindowType.NORMAL)
                    return;

                const wc = window.get_wm_class() ?? '';
                const wt = window.get_title() ?? '';
                if (wc) {
                    this._recentWindows = [
                        { wmClass: wc, title: wt, seenAt: Date.now() },
                        ...this._recentWindows.filter(w => !(w.wmClass === wc && w.title === wt)),
                    ].slice(0, 10);
                }

                const wmClass = wc;
                const title = wt.toLowerCase();
                const excluded = this._settings.get_strv('excluded-rules').some(rule => {
                    const sep = rule.indexOf('::');
                    if (sep === -1)
                        return rule === wmClass;
                    return rule.slice(0, sep) === wmClass &&
                           title.includes(rule.slice(sep + 2).toLowerCase());
                });
                if (excluded)
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
                // Guard against windows destroyed before the timer fires (e.g. Calibre's
                // temporary startup window), which would cause a native SIGSEGV uncatchable
                // by JS try-catch.
                let windowGone = false;
                const unmanagedId = window.connect('unmanaged', () => { windowGone = true; });
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                    try {
                        if (!windowGone) {
                            window.disconnect(unmanagedId);
                            if (!window.get_maximized())
                                doMaximize();
                        }
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        }, this);
    }

    GetRecentWindows() {
        const cutoff = Date.now() - 5 * 60 * 1000;
        const openKeys = new Set(
            global.display.list_all_windows()
                .filter(w => w.get_window_type() === Meta.WindowType.NORMAL)
                .map(w => `${w.get_wm_class() ?? ''}::${w.get_title() ?? ''}`)
        );
        const recent = (this._recentWindows ?? [])
            .filter(w => w.seenAt >= cutoff && !openKeys.has(`${w.wmClass}::${w.title}`));
        return JSON.stringify(recent.map(({ wmClass, title }) => ({ wmClass, title })));
    }

    GetOpenWindows() {
        const windows = global.display.list_all_windows()
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL && w.can_maximize())
            .map(w => ({ wmClass: w.get_wm_class() ?? '', title: w.get_title() ?? '' }))
            .filter(w => w.wmClass);
        return JSON.stringify(windows);
    }

    disable() {
        this._recentWindows = null;
        global.display.disconnectObject(this);
        this._dbusImpl.unexport();
        this._dbusImpl = null;
        this._settings = null;
    }
}
