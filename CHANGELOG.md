# Changelog

## 1.3.0 - Obsidian 1.13 Popout Window Support & Scroll Position Fixes - 06-08-2026

### 🔵 Compatibility (by [@nelsonlove](https://github.com/nelsonlove) - [PR #9](https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/pull/9))
- **Obsidian 1.13 support**: Fixed the plugin doing nothing on Obsidian 1.13, where Settings opens in a separate window by default. The sidebar organizing, notes tooltips, drag-and-drop, and compact mode now operate on the settings window's own document instead of the main window, working in both windowed and in-app settings modes (backward compatibility).

### 🟡 Refinements (by [@nelsonlove](https://github.com/nelsonlove) - [PR #9](https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/pull/9))
- **Scroll position**: Collapsing/expanding a group, reordering, locking, deleting, or editing matched plugins no longer jumps the settings view back to the top; the scroll position is restored synchronously before paint, so there is no flash. Huge thanks to [@nelsonlove](https://github.com/nelsonlove) ([PR #9](https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/pull/9))!

### 🔴 Deletions
- **Tooltip Position**: Removed the 'Left' position option for sidebar note tooltips as it is incompatible with Obsidian 1.13's separate popout settings window; defaults to 'Right' and auto-migrates existing settings.

## 1.2.0 - Exclude/Hide/Quick Add Keywords, Search, Group Lock, Auto-Notes and much more - 23-06-2026

### 🟢 New Features
- **Exclusion Keywords**: Added support for `!keyword` / `!"long keyword"` in keyword box.
- **Hide/Unhide**: Added an eye icon next to plugins in group settings to visually hide/unhide them from the sidebar without removing them from the group.
- **Master Toggles**: Added master toggle switches (enable/disable, hide/unhide all) to group settings.
- **Quick Add Keyword**: Added a selector button next to keywords to search and add installed plugins via modal instead of typing.
- **Search Bar**: Added a search bar below community plugins in the sidebar to search by name/alias (toggleable in settings).
- **Group Lock**: Added a lock icon to freeze matched plugins in specific groups (preventing any newly installed plugins from being automatically added to it, while still allowing the match count to decrease if a plugin is uninstalled).
- **Pointer Drag-and-Drop**: Switched to custom pointer events for reordering plugins and groups to support mouse wheel scrolling and edge auto-scrolling.
- **Collapsible Settings Cards**: Group cards in plugin settings can now be collapsed (showing title and match counts with badges) (for easier drag and drop).
- **Global Settings Controls**: Added a "Sort by..." alphabetical sorting dropdown and a global expand/collapse toggle for settings group cards.
- **Tooltip Position Setting**: Added a dropdown settings option to change sidebar note tooltips position (Left, Right, Hidden).
- **Auto-add Notes**: Added an option to automatically create notes with plugin descriptions for newly installed plugins (if they don't have a note yet), along with a modal to generate notes for existing plugins without notes if you want to.

### 🟡 Refinements
- **Sidebar Hover Cursor**: Changed organized sidebar plugins hover cursor to the default arrow.
- **Gear Icon Hit Area**: Enlarged the clickable target area of the sidebar settings gear icon.
- **Hidden Plugin Styling**: Applied grayed-out styling to hidden plugin rows (matching disabled ones) and moved status indicators before "[also in: ...]" in tooltips.
- **Disabled Plugin Visibility**: Prevented click interactions on the eye icon when a plugin is disabled.
- **Sidebar Active Styling**: Group items now inherit native Obsidian sidebar active tab styles for improved visual consistency with other sections.
- **Settings Indentation**: Improved the left-padding indentation of settings items inside group cards for better readability.
- **Bug Fixes**:
    - **Plugin Annotations**: Note editor and tooltips now strip `<!-- -->` HTML comment wrappers while preserving them in data files.
    - **Alias Syncing**: Fixed plugin aliases failing to synchronize globally across different groups.
    - **Settings Menu Memory**: The plugin now remembers which plugins have a settings menu after they are disabled, ensuring they remain correctly categorized in group settings.
    - **Collapse State Memory**: Sidebar folders now save their collapse states by their exact index rather than their title, preventing them from resetting when a group is renamed.
    - **Group Deletion Syncing**: Fixed a bug where deleting a group would shift and corrupt the saved collapse states of all subsequent groups below it.
    - **Tooltip Text Wrapping**: Added text-wrapping rules to note tooltips to prevent long continuous strings (like URLs) from breaking outside the visual boundaries.

### 🔴 Deletions
- **Reordering Arrows**: Removed the up/down arrow buttons for reordering groups in favor of the new drag-and-drop system.
- **Group Numbers**: Removed the "Group 1", "Group 2" etc. text from the headers of group cards in settings for a cleaner interface.
- **Tooltip Bolding**: Removed text bolding for plugins present in multiple groups inside the match counter tooltip.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.1.3...1.2.0

---

## 1.1.3 - Note Syncing & UI Refinements - 31-05-2026
- **Sidebar Notes**: Hover over any plugin in the sidebar to view its note in a custom tooltip.
- **Note Sync**: Notes are now fully synced with a markdown file without any lag. You can fully customize the path to this file (even supporting hidden folders like `.obsidian`), or leave the path empty/invalid to disable file syncing entirely. Internal memory is bulletproofed with true two-way sync timestamps to protect your notes from being overwritten by older files.
> **Note:** The "Open notes file" button next to the "Notes file path" setting dynamically highlights in your accent color if the target file actually exists. Also, if the path to your file is a hidden folder like `.obsidian`, then it will open in your OS's file explorer instead of a new tab in Obsidian.
- **Persistent Note Memory**: `data.json` acts as a persistent memory cache that safely stores your notes even if you uninstall a plugin. The external `.md` file remains clean and only shows notes for currently installed plugins. If you reinstall a plugin later, the plugin will automatically pull your old note from memory and instantly restore it to your `.md` sync file!
- **Append Description**: Added a convenient button in the note editor to pull and append the official plugin description from its manifest.
- **Sync Reliability**: Fixed a rare edge case where reinstalling a previously uninstalled plugin wouldn't immediately restore its backed-up note to your external sync file.
- **UI Polish**: 
    - Decluttered the plugin manager list by removing unnecessary arrows and perfectly aligned the sort combobox for a cleaner look.
    - Replaced the manage plugins gear icon with a pencil, and refined the modal background colors to a pleasing dark-to-light progression.
    - Added a helpful tip to the match counter badge tooltip explaining that keywords and full phrases can be separated by commas.
    - Added a quick tooltip to the plugin toggles in the group modal to clarify they enable/disable the actual plugin.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.1.2...1.1.3

---

## 1.1.2 - Toggles, Notes, and Massive QoL Improvements - 29-05-2026
- **Plugin Toggles:** You can now enable and disable plugins directly from the group configuration window! Changes apply smoothly only after you click "Save changes", so your sidebar doesn't flash annoyingly.
- **Plugin Notes:** Added the ability to write custom notes for any plugin. Just hover over the new note icon to read them! (Reddit @Responsible-Slide-26 feedback)
- **Plugin Deletion:** Added delete confirmation popups for groups. Group deletion triggers a 15-second grace period, letting you quickly delete multiple groups.
- **Flawless Detection:** Completely rebuilt the plugin scanner using Obsidian's native API. It now categorizes even those plugins that don't have a settings menu.
- **Better Tooltips:** The match counter hover badge now splits plugins into two clean categories (with/without a settings menu) and respects your custom sorting order.
- **Bug Fixes:** Added drag & drop instead of arrows inside group settings, and many more...

---

## 1.1.1 - 29-05-2026
- Error... bruh

---

## 1.1.0 - 29-05-2026
- Error

---

## 1.0.8 - Performance Boost, Tooltip Changes and QoL - 27-05-2026
- **Performance Overhaul:** Drastically reduced background resource usage. The plugin now completely "goes to sleep" when the settings window is closed, saving significant processor and Random Access Memory resources. (Reddit @AllMight_74 feedback)
- **Lightning Fast Sorting:** Swapped heavy text-scanning loops for instant DOM querying. The sidebar should still orginize instantly, even on older computers.
- **Smarter Tooltips:** Redesigned the hover tooltips to be much cleaner!
- **Accuracy Fix:** Disabled or hidden plugins are now strictly ignored and no longer falsely inflate the match counter badge.
- **Quality of Life:** Creating a "+ Add group" now instantly focuses the title input box and highlights the default text so you can start typing immediately. You can also use the Tab key to quickly jump straight into the next box! (Reddit @Miserable_Move_9854 feedback)

---

## 1.0.7 - 27-05-2026
- Small cleanups

---

## 1.0.6 - Proxy Refresh and Sorting Fixes - 27-05-2026
- **Fixes** Clear active proxy states on native item clicks and update sorting to use case-insensitive locale comparison

---

## 1.0.5 - Hover Tooltip Overhaul and Bug Fixes - 27-05-2026
- **Instant Tooltips:** Replaced native browser delays with a custom floating window engine. The match counter badge now displays the list of grabbed plugins instantly on hover with a 0ms delay.
- **Scroll Immunity:** Tooltips automatically dismiss the exact moment you begin scrolling inside the settings menu, preventing awkward visual overlaps.
- **Improved Settings State:** The "Collapse by default" feature now wipes the opened/closed memory the exact moment you close the settings window, rather than forcing you to wait for a background timer.
- **Bug fixes**: Fully migrated to ID matching instead of name matching, solving name-change duplication and multilanguage issues.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.4...1.0.5

---

## 1.0.4 - Multi-folder support, Sorting, and Quality of Life fixes - 26-05-2026
- **Multi-folder support**: Plugins can now live in multiple groups at the same time. If they do not match any, they safely fall into the "Ungrouped" folder.
- **Collapse by default**: Added a new setting toggle. If enabled, your folders will always start neatly closed when you open the settings menu.
- **Live match counter**: There is now a subtle badge next to your keyword boxes. Hover over it to instantly see exactly which plugins are being pulled into that group (including info about duplications if a plugin matches multiple keywords).
- **Sorting dropdown**: Added a new dropdown in the group management menu to sort your plugins alphabetically by alias.
- **Bug fixes**: Fixed an issue where certain plugins (like Enhancing Export) were missed by the scanner, and made the "Save changes" button smarter so it only lights up when actual changes are made.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.3...1.0.4

---

## 1.0.3 - Security Patch and Guidelines Compliance - 22-03-2026
- **Security Patch:** Replaced inline HyperText Markup Language injections with native Document Object Model creation methods to eliminate Cross-Site Scripting vulnerabilities.
- **Styling Refactor:** Moved all remaining hardcoded element styles to the dedicated Cascading Style Sheets file to ensure full compatibility with community themes.
- **User Interface Polish:** Updated settings text to use proper sentence case and removed redundant headings to seamlessly blend with the native Obsidian User Interface.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.2...1.0.3

---

## 1.0.2 - Code Cleanup and Rendering Fixes - 18-03-2026
- **Styling Refactor:** Extracted all Cascading Style Sheets into a dedicated `styles.css` file.
- **Rendering Reliability:** Fixed a race condition where the sidebar would sometimes fail to organize on slower computers.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.1...1.0.2

---

## 1.0.1 - Refresh Fix - 9-03-2026
fix: refresh proxy buttons on plugin status changes

---

## 1.0.0 - Initial Release - 15-02-2026
Initial release! 🎉
