# 🗂️ Obsidian Settings Sidebar Organizer

**Tame your plugin list.** Group community plugins, rename them (alias), reorder them manually or automatically, add notes, compact the sidebar UI headers, and much more...

### 📺 Plugin Showcase / Walkthrough:
https://github.com/user-attachments/assets/4b58aa90-8134-47de-9b36-bbcda0a48d24

## 🗿 Why?

Created because I had too many plugins and got lost in the sidebar; [feedback welcome!](https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/issues)

<a href="https://www.buymeacoffee.com/golomp" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

> [!CAUTION]
> **Experimental "DOM Hack":**
> This plugin manipulates the Obsidian UI directly because there is no official API for the settings sidebar.
> * **Risk:** If Obsidian updates their UI structure (CSS classes), this plugin might break or stop working until updated.
> * **Stability:** It creates "proxy" buttons. When you click an item in a group, it programmatically clicks the real, hidden button.

## ✨ Key Features

### 1. 📂 Grouping & Organization
* **Custom Folders:** Create your own categories (e.g., "Design", "Automation").
* **Multi-folder Support:** Plugins can belong to multiple groups at once.
* **Keyword Matching:** Sorts plugins into groups based on keywords separated by commas (including spaces). Supports matching exact phrases using `keyword1, long keyword2` and manual exclusion with `!keyword1, !"long keyword2"` (removing them from the group). Hover over a live-updating badge to see matches on the fly (showing multi-folder presence, if disabled, if hidden, and more).
* **Quick Add Keyword:** Open a selection modal next to the keyword box to quickly add installed plugins to it without typing.
* **Hide/Unhide:** Visually hide/unhide specific matched plugins from a group using the eye icon toggle (without removing them from the group).
* **"Ungrouped" Folder:** Automatically catches any plugin that doesn't match your keywords so nothing gets lost (can be hidden).
* **Group Lock:** Freeze any group's matched plugins to prevent newly installed plugins from auto-matching, while still allowing the match count to decrease if a plugin is uninstalled.

### 2. ✏️ Aliases & Order
* **Aliasing:** Rename plugins to save space or improve clarity. Aliases automatically synchronize globally for the same plugin.
* **Sorting Options:** Sort your plugins/groups alphabetically, or drag & drop them exactly how you want them (espects native scroll wheel sensitivity and supports proximity auto-scrolling).

### 3. 📝 Plugin Management & Notes
* **Plugin Toggles:** Enable/disable your plugins directly from the group configuration menu. Use master switches to instantly toggle or hide/unhide all plugins in a group at once.
* **Custom Notes:** Add personal notes to any plugin (e.g., why you disabled it or what it does). Hover over the note icon or the plugin in the sidebar to read it. Supports compatibility with other plugins (like Plugin Annotations) by hiding HTML comment wrappers in the UI.
* **Auto-add Notes:** Atomatically create notes with official plugin descriptions for newly installed plugins (if they don't have a note yet), along with a modal to generate notes for existing plugins (if you want to).
* **One-File Note Sync:** Keep your notes in sync with a standalone `.md` file for easy bulk editing. Supports custom paths, even inside hidden system folders like `.obsidian/plugins/Notes.md`.

### 4. 📉 Compact & Clean UI
* **Search Bar:** Quickly search plugins in the sidebar by their aliases or original names (can be toggled in settings).
* **Group Controls:** Collapse/expand group cards in the plugin settings menu to keep it tidy, with options to sort all groups alphabetically and a toggle to expand/collapse all groups at once (easier drag & drop).
* **Compact Mode:** Hides the large "Core plugins" and "Community plugins" tabs. It moves them to small ⚙️ icons in the section headers to improve clarity.
* **Collapsible Headers:** Allows you to fold the main "Options", "Core plugins", and "Community plugins" sections.
* **Collapse by Default:** Option to automatically collapse all groups each time you reopen the settings menu (instead of saving exactly how you left them).

## 📦 Installation

### Method 1: Obsidian site (the fastest)
1. Go to https://community.obsidian.md/plugins/settings-sidebar-organizer.
2. Click `Add to Obsidian`.
3. Click **Install**, then **Enable**.

### Method 2: Inside Obsidian
1. Open Obsidian and go to **Settings > Community plugins > Browse**.
2. Search for `Settings Sidebar Organizer`.
3. Click **Install**, then **Enable**.

### Method 3: Manual
1. Download `main.js`, `styles.css`, and `manifest.json`.
2. Create folder `.obsidian/plugins/settings-sidebar-organizer/`.
3. Paste files and reload Obsidian.

## ⚙️ How to use
Everything is configured via **Settings > Settings Sidebar Organizer**:

1.  **Create Group:** Click `+ Add Group`.
2.  **Assign Plugins:** Type/Add keywords (comma-separated) in the "Keywords" box.
3.  **Fine-tune:** Click the **Gear Icon (⚙️)** next to a group to:
    * **Reorder** items manually via drag & drop or **Sort** them alphabetically.
    * **Toggle** plugins on/off or hide/unhide them.
    * Set an **Alias** (rename).
    * Write **Notes** for your plugins.
