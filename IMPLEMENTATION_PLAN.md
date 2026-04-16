# Implementation Plan: Exclusion Preferences UI

## Files to change

| File | Change |
|---|---|
| `src/prefs.js` | Full rewrite — preferences UI |
| `src/extension.js` | Read `excluded-apps` from GSettings and skip excluded windows |
| `src/schemas/...gschema.xml` | No changes needed |

---

## 1. `src/prefs.js`

### Overall structure

- One `Adw.PreferencesPage` → one `Adw.PreferencesGroup` titled "Excluded Applications"
- Above the group: a visually distinct `Gtk.Box` header row (text entry + action button)
- Inside the group: zero or more exclusion rows, plus a placeholder when empty

### 1a. Header row — Gtk.Box with entry + button

A `Gtk.Box` (horizontal, with padding/margin to sit visually above the list group) containing:

- A `Gtk.Entry` (expands to fill available width) with placeholder text `"Enter WM_CLASS…"`
- A `Gtk.Button` (fixed width, right-aligned)

**Button label logic** (update on every `notify::text` signal of the entry):
- Entry is empty → label is `"Pick Window"`
- Entry has text → label is `"Add to List"`

**Button / Enter key action** (connect both `clicked` on the button and `activate` on the entry):
- If entry is empty → open the Window Picker dialog (see §2)
- If entry has text:
  - Trim whitespace
  - If the trimmed value is already in `excluded-apps` → do nothing (silently)
  - Otherwise → append to GSettings `excluded-apps`, clear the entry, rebuild the list

### 1b. Exclusion list rows

Each saved WM_CLASS gets an `Adw.ActionRow`:
- Title: the WM_CLASS string
- Suffix: a `Gtk.Button` with trash icon (`user-trash-symbolic`), styled with `destructive-action` CSS class
- Clicking trash → remove from GSettings `excluded-apps`, rebuild the list

Sort order: case-insensitive alphabetical by WM_CLASS.

### 1c. Empty state placeholder

A single `Adw.ActionRow` with:
- Title: `"No applications excluded"`
- `sensitive: false` (greyed out, non-interactive)
- Shown only when `excluded-apps` is empty; hidden otherwise

---

## 2. Window Picker dialog

### Trigger
Opened when the user clicks "Pick Window" (entry is empty).

### Type
`Adw.Dialog` (modal, attached to the prefs window). Title: `"Pick a Window"`.

### Fetching the window list

`prefs.js` runs in a separate process and cannot access `global.display` directly.
Use D-Bus to call `org.gnome.Shell`'s `Eval` method, which executes a JS string inside
the shell process and returns the result as a JSON string:

```js
const shell = Gio.DBusProxy.new_sync(
    Gio.bus_get_sync(Gio.BusType.SESSION, null),
    Gio.DBusProxyFlags.NONE, null,
    'org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', null
);
const [json] = shell.call_sync('Eval',
    new GLib.Variant('(s)', [
        `JSON.stringify(
            global.display.list_all_windows()
                .filter(w => w.get_window_type() === 0)  // Meta.WindowType.NORMAL
                .map(w => ({ wmClass: w.get_wm_class(), title: w.get_title() }))
        )`
    ]),
    Gio.DBusCallFlags.NONE, -1, null
);
// json is a (boolean, string) variant; the string is the JSON array
```

Filter out entries whose `wmClass` is already in `excluded-apps` before building the list.

### Content

A `Gtk.ScrolledWindow` containing a `Gtk.ListBox`.

**Rows**, after filtering and sorting by `wmClass` (case-insensitive), then `title`:

- Primary text: `wmClass`
- Secondary text / subtitle: `title`
- Suffix: `Gtk.Button` with `list-add-symbolic` icon

**On clicking `+`:**

- Append the row's `wmClass` to GSettings `excluded-apps`
- Remove all rows with that `wmClass` from the dialog list
- If the list is now empty → close the dialog automatically

---

## 3. `src/extension.js`

In `enable()`, instantiate `Gio.Settings` for the extension schema. In the
`window-created` → `shown` handler, after the existing type and `can_maximize()` checks:

```js
const excluded = this._settings.get_strv('excluded-apps');
if (excluded.includes(window.get_wm_class())) return;
```

In `disable()`, set `this._settings = null`.

No live GSettings watcher needed — the value is read fresh on every window-creation event.

---

## Open questions / deferred

- Excluding by WM_CLASS *and* title (possible future feature, not in scope)
- Handling Flatpak `sandboxed_app_id` separately from WM_CLASS (not in scope)
