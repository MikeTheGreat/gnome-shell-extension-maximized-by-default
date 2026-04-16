import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MaximizedByDefaultPreferences extends ExtensionPreferences {
    fillPreferencesWindow(prefsWindow) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        prefsWindow.add(page);

        // Input area — visually distinct group above the list
        const inputGroup = new Adw.PreferencesGroup();
        page.add(inputGroup);

        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_top: 4,
            margin_bottom: 4,
        });

        const entry = new Gtk.Entry({
            placeholder_text: 'Enter WM_CLASS…',
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });

        const actionButton = new Gtk.Button({
            label: 'Pick Window',
            valign: Gtk.Align.CENTER,
        });

        headerBox.append(entry);
        headerBox.append(actionButton);
        inputGroup.add(headerBox);

        // Exclusion list group
        const listGroup = new Adw.PreferencesGroup({
            title: 'Excluded Applications',
            description: 'Windows from these applications will not be maximized on launch.',
        });
        page.add(listGroup);

        const placeholder = new Adw.ActionRow({
            title: 'No applications excluded',
            sensitive: false,
        });
        listGroup.add(placeholder);

        let listRows = [];

        const rebuildList = () => {
            for (const row of listRows)
                listGroup.remove(row);
            listRows = [];

            const excluded = settings.get_strv('excluded-apps');
            placeholder.visible = excluded.length === 0;

            const sorted = [...excluded].sort((a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase()));

            for (const wmClass of sorted) {
                const row = new Adw.ActionRow({ title: wmClass });
                const trashBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['destructive-action'],
                });
                trashBtn.connect('clicked', () => {
                    const current = settings.get_strv('excluded-apps');
                    settings.set_strv('excluded-apps', current.filter(x => x !== wmClass));
                });
                row.add_suffix(trashBtn);
                listGroup.add(row);
                listRows.push(row);
            }
        };

        settings.connect('changed::excluded-apps', rebuildList);
        rebuildList();

        // Button label tracks entry content
        entry.connect('notify::text', () => {
            actionButton.label = entry.text.trim() ? 'Add to List' : 'Pick Window';
        });

        const doAction = () => {
            const text = entry.text.trim();
            if (text) {
                const current = settings.get_strv('excluded-apps');
                if (!current.includes(text))
                    settings.set_strv('excluded-apps', [...current, text]);
                entry.set_text('');
            } else {
                this._openPicker(prefsWindow, settings);
            }
        };

        actionButton.connect('clicked', doAction);
        entry.connect('activate', doAction);
    }

    _fetchWindows() {
        try {
            const result = Gio.DBus.session.call_sync(
                'org.gnome.Shell',
                '/org/gnome/Shell/Extensions/MaximizedByDefault',
                'org.gnome.Shell.Extensions.MaximizedByDefault',
                'GetOpenWindows',
                null,
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const [json] = result.deepUnpack();
            const seen = new Set();
            return JSON.parse(json).filter(w => {
                if (!w.wmClass || seen.has(w.wmClass))
                    return false;
                seen.add(w.wmClass);
                return true;
            });
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    _openPicker(prefsWindow, settings) {
        const pickerWindow = new Gtk.Window({
            title: 'Pick a Window',
            modal: true,
            transient_for: prefsWindow,
            default_width: 500,
            default_height: 400,
            destroy_with_parent: true,
        });

        const scrolled = new Gtk.ScrolledWindow({ vexpand: true });
        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        scrolled.set_child(listBox);
        pickerWindow.set_child(scrolled);

        const populate = (autoClose = false) => {
            let child = listBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                listBox.remove(child);
                child = next;
            }

            const excluded = settings.get_strv('excluded-apps');
            const allWindows = this._fetchWindows();
            const windows = allWindows.filter(w => !excluded.includes(w.wmClass));

            if (windows.length === 0) {
                if (autoClose) {
                    pickerWindow.close();
                    return;
                }
                const label = allWindows.length === 0
                    ? 'No open windows found.\nMake sure the extension is enabled.'
                    : 'All currently open windows are already in the excluded list.';
                const emptyRow = new Gtk.ListBoxRow({ selectable: false });
                emptyRow.set_child(new Gtk.Label({
                    label,
                    margin_top: 12,
                    margin_bottom: 12,
                }));
                listBox.append(emptyRow);
                return;
            }

            const sorted = [...windows].sort((a, b) => {
                const c = a.wmClass.toLowerCase().localeCompare(b.wmClass.toLowerCase());
                return c !== 0 ? c : a.title.toLowerCase().localeCompare(b.title.toLowerCase());
            });

            for (const win of sorted) {
                const row = new Adw.ActionRow({
                    title: win.wmClass,
                    subtitle: win.title,
                });
                const addBtn = new Gtk.Button({
                    icon_name: 'list-add-symbolic',
                    valign: Gtk.Align.CENTER,
                });
                addBtn.connect('clicked', () => {
                    const current = settings.get_strv('excluded-apps');
                    if (!current.includes(win.wmClass))
                        settings.set_strv('excluded-apps', [...current, win.wmClass]);
                    populate(true);
                });
                row.add_suffix(addBtn);
                listBox.append(row);
            }
        };

        populate(false);
        pickerWindow.present();
    }
}
