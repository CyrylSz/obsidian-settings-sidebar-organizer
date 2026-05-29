# Changelog

## 1.1.2 - Toggles, Notes, and Massive QoL Improvements - 29-05-2026
- **Plugin Toggles:** You can now enable and disable plugins directly from the group configuration window! Changes apply smoothly only after you click "Save changes", so your sidebar doesn't flash annoyingly.
- **Plugin Notes:** Added the ability to write custom notes for any plugin. Just hover over the new note icon to read them! (Reddit @Responsible-Slide-26 feedback)
- **Plugin Deletion:** Added delete confirmation popups for groups.Group deletion triggers a 15-second grace period, letting you quickly delete multiple groups.
- **Flawless Detection:** Completely rebuilt the plugin scanner using Obsidian's native API. It now categorizes even those plugins that don't have a settings menu.
- **Better Tooltips:** The match counter hover badge now splits plugins into two clean categories (with/without a settings menu) and respects your custom sorting order.
- **Bug Fixes:** Added drag & drop instead of arrows inside group settings, and many more...

## 1.1.1 - 29-05-2026
- Error... bruh

## 1.1.0 - 29-05-2026
- Error

## 1.0.8 - Performance Boost, Tooltip Changes and QoL - 27-05-2026
- **Performance Overhaul:** Drastically reduced background resource usage. The plugin now completely "goes to sleep" when the settings window is closed, saving significant processor and Random Access Memory resources. (Reddit @AllMight_74 feedback)
- **Lightning Fast Sorting:** Swapped heavy text-scanning loops for instant DOM querying. The sidebar should still orginize instantly, even on older computers.
- **Smarter Tooltips:** Redesigned the hover tooltips to be much cleaner!
- **Accuracy Fix:** Disabled or hidden plugins are now strictly ignored and no longer falsely inflate the match counter badge.
- **Quality of Life:** Creating a "+ Add group" now instantly focuses the title input box and highlights the default text so you can start typing immediately. You can also use the Tab key to quickly jump straight into the next box! (Reddit @Miserable_Move_9854 feedback)

## 1.0.7 - 27-05-2026
- Small cleanups

## 1.0.6 - Proxy Refresh and Sorting Fixes - 27-05-2026
- **Fixes** Clear active proxy states on native item clicks and update sorting to use case-insensitive locale comparison

## 1.0.5 - Hover Tooltip Overhaul and Bug Fixes - 27-05-2026
- **Instant Tooltips:** Replaced native browser delays with a custom floating window engine. The match counter badge now displays the list of grabbed plugins instantly on hover with a 0ms delay.
- **Scroll Immunity:** Tooltips automatically dismiss the exact moment you begin scrolling inside the settings menu, preventing awkward visual overlaps.
- **Improved Settings State:** The "Collapse by default" feature now wipes the opened/closed memory the exact moment you close the settings window, rather than forcing you to wait for a background timer.
- **Bug fixes**: Fully migrated to ID matching instead of name matching, solving name-change duplication and multilanguage issues.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.4...1.0.5

## 1.0.4 - Multi-folder support, Sorting, and Quality of Life fixes - 26-05-2026
- **Multi-folder support**: Plugins can now live in multiple groups at the same time. If they do not match any, they safely fall into the "Ungrouped" folder.
- **Collapse by default**: Added a new setting toggle. If enabled, your folders will always start neatly closed when you open the settings menu.
- **Live match counter**: There is now a subtle badge next to your keyword boxes. Hover over it to instantly see exactly which plugins are being pulled into that group (including info about duplications if a plugin matches multiple keywords).
- **Sorting dropdown**: Added a new dropdown in the group management menu to sort your plugins alphabetically by alias.
- **Bug fixes**: Fixed an issue where certain plugins (like Enhancing Export) were missed by the scanner, and made the "Save changes" button smarter so it only lights up when actual changes are made.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.3...1.0.4

## 1.0.3 - Security Patch and Guidelines Compliance - 22-03-2026
- **Security Patch:** Replaced inline HyperText Markup Language injections with native Document Object Model creation methods to eliminate Cross-Site Scripting vulnerabilities.
- **Styling Refactor:** Moved all remaining hardcoded element styles to the dedicated Cascading Style Sheets file to ensure full compatibility with community themes.
- **User Interface Polish:** Updated settings text to use proper sentence case and removed redundant headings to seamlessly blend with the native Obsidian User Interface.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.2...1.0.3

## 1.0.2 - Code Cleanup and Rendering Fixes - 18-03-2026
- **Styling Refactor:** Extracted all Cascading Style Sheets into a dedicated `styles.css` file.
- **Rendering Reliability:** Fixed a race condition where the sidebar would sometimes fail to organize on slower computers.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.1...1.0.2

## 1.0.1 - Refresh Fix - 9-03-2026
fix: refresh proxy buttons on plugin status changes

## 1.0.0 - Initial Release - 15-02-2026
Initial release! 🎉
