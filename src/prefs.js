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
            placeholder_text: 'WMClass  or  WMClass::TitlePattern',
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
            title: 'Exclusion Rules',
            description: 'Windows matching these rules will not be maximized on launch.',
        });
        page.add(listGroup);

        const placeholder = new Adw.ActionRow({
            title: 'No exclusion rules',
            sensitive: false,
        });
        listGroup.add(placeholder);

        let listRows = [];

        const rebuildList = () => {
            for (const row of listRows)
                listGroup.remove(row);
            listRows = [];

            const rules = settings.get_strv('excluded-rules');
            placeholder.visible = rules.length === 0;

            const sorted = [...rules].sort((a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase()));

            for (const rule of sorted) {
                const sep = rule.indexOf('::');
                let title, subtitle;
                if (sep === -1) {
                    title = rule;
                    subtitle = 'All windows';
                } else {
                    title = rule.slice(0, sep);
                    subtitle = `Title contains: "${rule.slice(sep + 2)}"`;
                }
                const row = new Adw.ActionRow({ title, subtitle });
                const trashBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['destructive-action'],
                });
                trashBtn.connect('clicked', () => {
                    const current = settings.get_strv('excluded-rules');
                    settings.set_strv('excluded-rules', current.filter(x => x !== rule));
                });
                row.add_suffix(trashBtn);
                listGroup.add(row);
                listRows.push(row);
            }
        };

        settings.connect('changed::excluded-rules', rebuildList);
        rebuildList();

        // Button label tracks entry content
        entry.connect('notify::text', () => {
            actionButton.label = entry.text.trim() ? 'Add to List' : 'Pick Window';
        });

        const doAction = () => {
            const text = entry.text.trim();
            if (text) {
                const current = settings.get_strv('excluded-rules');
                if (!current.includes(text))
                    settings.set_strv('excluded-rules', [...current, text]);
                entry.set_text('');
            } else {
                this._openPicker(prefsWindow, settings);
            }
        };

        actionButton.connect('clicked', doAction);
        entry.connect('activate', doAction);
    }

    _fetchWindows() {
        return this._callDbus('GetOpenWindows');
    }

    _fetchRecentWindows() {
        return this._callDbus('GetRecentWindows');
    }

    _callDbus(method) {
        try {
            const result = Gio.DBus.session.call_sync(
                'org.gnome.Shell',
                '/org/gnome/Shell/Extensions/MaximizedByDefault',
                'org.gnome.Shell.Extensions.MaximizedByDefault',
                method,
                null,
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const [json] = result.deepUnpack();
            return JSON.parse(json).filter(w => w.wmClass);
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
            default_width: 540,
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

            const rules = settings.get_strv('excluded-rules');
            const classOnlyRules = new Set(rules.filter(r => !r.includes('::')));

            const filterExcluded = wins => wins.filter(w => {
                if (classOnlyRules.has(w.wmClass)) return false;
                return !rules.includes(`${w.wmClass}::${w.title}`);
            });

            const sortWins = wins => [...wins].sort((a, b) => {
                const c = a.wmClass.toLowerCase().localeCompare(b.wmClass.toLowerCase());
                return c !== 0 ? c : a.title.toLowerCase().localeCompare(b.title.toLowerCase());
            });

            const allOpen = this._fetchWindows();
            const allRecent = this._fetchRecentWindows();

            const openKeys = new Set(allOpen.map(w => `${w.wmClass}::${w.title}`));
            const windows = filterExcluded(allOpen);
            const recent = filterExcluded(allRecent).filter(
                w => !openKeys.has(`${w.wmClass}::${w.title}`)
            );

            if (windows.length === 0 && recent.length === 0) {
                if (autoClose) {
                    pickerWindow.close();
                    return;
                }
                const label = allOpen.length === 0 && allRecent.length === 0
                    ? 'No windows found.\nMake sure the extension is enabled.'
                    : 'All windows are already excluded.';
                const emptyRow = new Gtk.ListBoxRow({ selectable: false });
                emptyRow.set_child(new Gtk.Label({
                    label,
                    margin_top: 12,
                    margin_bottom: 12,
                }));
                listBox.append(emptyRow);
                return;
            }

            const addSectionHeader = label => {
                const headerRow = new Gtk.ListBoxRow({ selectable: false, activatable: false });
                headerRow.set_child(new Gtk.Label({
                    label,
                    xalign: 0,
                    css_classes: ['heading'],
                    margin_top: 8,
                    margin_bottom: 4,
                    margin_start: 6,
                }));
                listBox.append(headerRow);
            };

            const addWindowRow = (win, afterTitleClick) => {
                const row = new Adw.ActionRow({
                    title: win.wmClass,
                    subtitle: win.title,
                });

                const excludeAppBtn = new Gtk.Button({
                    label: 'App',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Exclude all windows from this app',
                });
                const excludeTitleBtn = new Gtk.Button({
                    label: 'Title',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Exclude only windows with this title',
                });

                excludeAppBtn.connect('clicked', () => {
                    const current = settings.get_strv('excluded-rules');
                    if (!current.includes(win.wmClass))
                        settings.set_strv('excluded-rules', [...current, win.wmClass]);
                    populate(true);
                });
                excludeTitleBtn.connect('clicked', () => {
                    const rule = `${win.wmClass}::${win.title}`;
                    const current = settings.get_strv('excluded-rules');
                    if (!current.includes(rule))
                        settings.set_strv('excluded-rules', [...current, rule]);
                    afterTitleClick();
                });

                row.add_suffix(excludeAppBtn);
                row.add_suffix(excludeTitleBtn);
                listBox.append(row);
            };

            if (windows.length > 0) {
                if (recent.length > 0)
                    addSectionHeader('Open');
                for (const win of sortWins(windows))
                    addWindowRow(win, () => populate(false));
            }

            if (recent.length > 0) {
                addSectionHeader('Recently closed (last 5 min)');
                for (const win of sortWins(recent))
                    addWindowRow(win, () => populate(false));
            }
        };

        populate(false);
        pickerWindow.present();
    }
}
