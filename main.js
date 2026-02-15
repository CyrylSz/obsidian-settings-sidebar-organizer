const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    showUngrouped: true,
    collapsibleHeaders: true,
    compactMode: false,
    groups: [],
    collapsedSections: [],
    collapsedGroups: {}
};

module.exports = class MyOrganizerPlugin extends obsidian.Plugin {
    async onload() {
        console.log('My Organizer Loaded (Fixed: Clicks & Scroll Lag)');
        await this.loadSettings();
        this.addSettingTab(new MyOrganizerSettingTab(this.app, this));
        this.addStyle();

        // Flag to prevent infinite loops (Observer -> DOM change -> Observer)
        this.isOrganizing = false;
        // Flag indicating if the observer is currently attached
        this.observing = false;

        // Use MutationObserver instead of polling to prevent scroll lag.
        // It reacts only to actual DOM changes (node additions/removals).
        this.observer = new MutationObserver((mutations) => {
            if (this.isOrganizing) return;
            // Check for significant DOM changes (node addition/removal)
            const hasNodeChanges = mutations.some(m => m.type === 'childList');
            if (hasNodeChanges) {
                this.checkAndApply();
            }
        });

        this.app.workspace.onLayoutReady(() => {
            this.restoreSectionStates();
            // Start a lightweight interval to check if the settings window is open.
            // If open -> attach Observer and stop checking.
            this.startSidebarWatcher();
        });

        this.registerDomEvent(document, 'click', (evt) => {
            if (!this.settings.collapsibleHeaders) return;
            if (evt.target.closest('.my-org-section-btn')) return;

            if (evt.target.classList.contains('vertical-tab-header-group-title')) {
                const header = evt.target;
                const title = header.innerText.trim();
                const group = header.parentElement;
                const itemsContainer = group.querySelector('.vertical-tab-header-group-items');

                if (itemsContainer) {
                    const isCollapsed = itemsContainer.classList.toggle('is-collapsed');
                    header.classList.toggle('is-collapsed', isCollapsed);

                    if (isCollapsed) {
                        if (!this.settings.collapsedSections.includes(title)) this.settings.collapsedSections.push(title);
                    } else {
                        this.settings.collapsedSections = this.settings.collapsedSections.filter(t => t !== title);
                    }
                    this.saveSettings(false);
                    evt.stopPropagation();
                }
            }
        });
    }

    // Manages sidebar observation logic
    startSidebarWatcher() {
        this.registerInterval(window.setInterval(() => {
            const sidebar = document.querySelector('.vertical-tab-header-group-items');

            if (sidebar) {
                // Sidebar exists (settings are open)
                if (!this.observing) {
                    this.observing = true;
                    // Listen for changes in the element list
                    this.observer.observe(sidebar, { childList: true, subtree: true });
                    // Trigger organization once at start
                    this.checkAndApply();
                }
            } else {
                // Sidebar does not exist (settings are closed)
                if (this.observing) {
                    this.observer.disconnect();
                    this.observing = false;
                }
            }
        }, 1000)); // Checking existence every 1s is resource-efficient
    }

    onunload() {
        if (this.observer) this.observer.disconnect();
        const style = document.getElementById('my-org-styles');
        if (style) style.remove();
        document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
        document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
        document.querySelectorAll('.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
        document.querySelectorAll('.my-org-hide-nav').forEach(el => el.classList.remove('my-org-hide-nav'));
        document.querySelectorAll('.my-org-section-btn').forEach(btn => btn.remove());
    }

    addStyle() {
        const existing = document.getElementById('my-org-styles');
        if (existing) existing.remove();

        const collapseEnabled = this.settings.collapsibleHeaders;

        const css = `
            .my-org-hidden { display: none !important; }
            .my-org-hide-nav { display: none !important; }

            /* --- BUTTON CONTAINER STYLE --- */
            .my-org-add-group-container {
                width: 100%;
                text-align: center;
                margin-top: 25px;
                margin-bottom: 20px;
                display: block;
            }

            .my-org-section-btn {
                position: absolute;
                right: ${collapseEnabled ? '35px' : '10px'};
                top: 50%;
                transform: translateY(-50%);
                cursor: pointer;
                color: var(--text-muted);
                opacity: 0.7;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 4px;
                border-radius: 4px;
                transition: all 0.2s ease;
                z-index: 10;
            }
            .my-org-section-btn:hover {
                background-color: var(--background-modifier-hover);
                color: var(--text-normal);
                opacity: 1;
            }

            .my-org-folder {
                border-top: 1px solid var(--background-modifier-border);
                width: 100%;
                margin-top: -1px;
            }
            .my-org-folder.my-org-special {
                border-top: 1px solid var(--interactive-accent); 
                margin-top: 5px;
            }
            .my-org-summary {
                cursor: pointer;
                padding: 8px 12px;
                font-weight: 600;
                background-color: var(--background-secondary); 
                color: var(--text-normal);
                border-left: 4px solid var(--interactive-accent);
                display: flex;
                align-items: center;
                border-radius: 0 4px 4px 0;
                margin-bottom: 2px;
                user-select: none;
                font-size: 13px;
                transition: background-color 0.1s;
            }
            .my-org-summary:hover {
                background-color: var(--background-modifier-hover);
            }
            .my-org-summary::before {
                content: '▶';
                font-size: 8px;
                margin-right: 8px;
                transition: transform 0.1s;
                color: var(--text-muted);
            }
            .my-org-folder[open] .my-org-summary::before {
                transform: rotate(90deg);
            }
            .my-org-folder > summary { list-style: none; }
            .my-org-folder > summary::-webkit-details-marker { display: none; }
            
            .my-org-proxy {
                padding: 6px 12px 6px 32px;
                cursor: pointer;
                color: var(--text-muted);
                font-size: 13px;
                border-radius: 4px;
                display: block;
            }
            .my-org-proxy:hover {
                background-color: var(--background-modifier-hover);
                color: var(--text-normal);
            }
            .my-org-proxy.is-active {
                background-color: var(--background-modifier-active-hover);
                color: var(--text-normal);
                font-weight: bold;
            }

            .vertical-tab-header-group-title {
                cursor: ${collapseEnabled ? 'pointer' : 'default'};
                position: relative;
                transition: color 0.2s;
            }
            .vertical-tab-header-group-title:hover {
                color: ${collapseEnabled ? 'var(--text-accent)' : 'inherit'};
            }
            .vertical-tab-header-group-title::after {
                content: '▼';
                position: absolute;
                right: 15px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 10px;
                color: var(--text-faint);
                transition: transform 0.2s;
                display: ${collapseEnabled ? 'block' : 'none'};
            }
            .vertical-tab-header-group-title.is-collapsed::after {
                transform: translateY(-50%) rotate(-90deg);
            }
            .vertical-tab-header-group-items.is-collapsed {
                display: none;
            }

            .my-org-modal-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-top: 15px;
                max-height: 60vh;
                overflow-y: auto;
                padding-right: 5px;
            }
            .my-org-modal-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px;
                background-color: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                flex-shrink: 0;
            }
            .my-org-modal-item-name {
                flex: 1;
                font-size: 13px;
                color: var(--text-muted);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .my-org-modal-arrow {
                color: var(--text-faint);
                font-weight: bold;
            }
            .my-org-modal-item input {
                width: 150px;
            }
            .my-org-modal-controls {
                display: flex;
                gap: 2px;
            }
            .my-org-modal-btn {
                padding: 2px 6px;
                cursor: pointer;
                color: var(--text-muted);
                border-radius: 4px;
            }
            .my-org-modal-btn:hover {
                background-color: var(--background-modifier-hover);
                color: var(--text-normal);
            }
            .my-org-btn-reset {
                background-color: var(--interactive-normal);
                color: var(--text-normal);
                border: 1px solid var(--background-modifier-border);
                box-shadow: var(--input-shadow);
                cursor: pointer;
                transition: background-color 0.1s ease;
            }
            .my-org-btn-reset:hover {
                background-color: var(--interactive-hover);
                color: var(--text-normal);
            }
        `;
        const styleEl = document.createElement('style');
        styleEl.id = 'my-org-styles';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(shouldReorganize = true) {
        await this.saveData(this.settings);
        if (shouldReorganize) {
            document.querySelectorAll('.my-org-folder').forEach(f => f.remove());
            document.querySelectorAll('.my-org-hidden').forEach(h => h.classList.remove('my-org-hidden'));
            this.checkAndApply();
        }
    }

    restoreSectionStates() {
        if (!this.settings.collapsibleHeaders) return;
        const headers = document.querySelectorAll('.vertical-tab-header-group-title');
        headers.forEach(header => {
            const title = header.innerText.trim();
            if (this.settings.collapsedSections.includes(title)) {
                header.classList.add('is-collapsed');
                const group = header.parentElement;
                const items = group.querySelector('.vertical-tab-header-group-items');
                if (items) items.classList.add('is-collapsed');
            }
        });
    }

    manageCompactMode() {
        const sidebar = document.querySelector('.vertical-tab-content-container');
        const navItems = Array.from(document.querySelectorAll('.vertical-tab-nav-item'));
        const headers = Array.from(document.querySelectorAll('.vertical-tab-header-group-title'));

        const targets = ['Core plugins', 'Community plugins'];
        const targetNavItems = navItems.filter(item => targets.includes(item.innerText.trim()));
        const targetHeaders = headers.filter(h => targets.includes(h.innerText.trim()));

        if (this.settings.compactMode) {
            targetNavItems.forEach(item => {
                item.classList.add('my-org-hide-nav');
            });

            targetHeaders.forEach(header => {
                if (header.querySelector('.my-org-section-btn')) return;

                const btn = document.createElement('div');
                btn.className = 'my-org-section-btn';
                btn.setAttribute('aria-label', `Manage ${header.innerText}`);
                obsidian.setIcon(btn, 'settings');

                btn.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const name = header.innerText.trim();
                    const linkToClick = targetNavItems.find(i => i.innerText.trim() === name);
                    if (linkToClick) linkToClick.click();
                };
                header.appendChild(btn);
            });
        } else {
            targetNavItems.forEach(item => item.classList.remove('my-org-hide-nav'));
            document.querySelectorAll('.my-org-section-btn').forEach(b => b.remove());
        }
    }

    checkAndApply() {
        const sidebar = document.querySelector('.vertical-tab-header-group-items');
        if (!sidebar) return;

        // Restore collapse if needed
        if (this.settings.collapsibleHeaders) {
            const firstCollapsed = this.settings.collapsedSections[0];
            if (firstCollapsed) {
                const header = Array.from(document.querySelectorAll('.vertical-tab-header-group-title'))
                    .find(h => h.innerText.trim() === firstCollapsed);
                if (header && !header.classList.contains('is-collapsed')) {
                    this.restoreSectionStates();
                }
            }
        }

        this.organizeSidebar();
        this.manageCompactMode();
    }

    organizeSidebar() {
        // Set flag to indicate internal DOM modification so the Observer ignores us
        this.isOrganizing = true;

        if (!this.app.plugins || !this.app.plugins.manifests) {
            this.isOrganizing = false;
            return;
        }

        const pluginNames = Object.values(this.app.plugins.manifests).map(m => m.name);
        const allNavItems = Array.from(document.querySelectorAll('.vertical-tab-nav-item'));
        if (allNavItems.length === 0) {
            this.isOrganizing = false;
            return;
        }

        let targetContainer = null;
        for (const item of allNavItems) {
            if (pluginNames.includes(item.innerText.trim()) || pluginNames.some(p => item.innerText.includes(p))) {
                targetContainer = item.parentElement;
                break;
            }
        }
        if (!targetContainer) {
            this.isOrganizing = false;
            return;
        }

        // Clean up
        targetContainer.querySelectorAll('.my-org-folder').forEach(el => el.remove());
        targetContainer.querySelectorAll('.my-org-hidden').forEach(el => el.classList.remove('my-org-hidden'));

        const pluginItems = Array.from(targetContainer.querySelectorAll('.vertical-tab-nav-item'));

        // Prepare Groups
        const groupsMap = this.settings.groups.map(g => {
            const details = document.createElement('details');
            details.className = 'my-org-folder';
            const isOpen = this.settings.collapsedGroups[g.title] !== false;
            details.open = isOpen;
            details.innerHTML = `<summary class="my-org-summary">${g.title}</summary>`;
            details.addEventListener('toggle', () => {
                this.settings.collapsedGroups[g.title] = details.open;
                this.saveSettings(false);
            });
            return {
                data: g,
                element: details,
                keywords: g.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
                items: g.items || [],
                proxies: []
            };
        });

        const ungroupedDetails = document.createElement('details');
        ungroupedDetails.className = 'my-org-folder my-org-special';
        ungroupedDetails.open = this.settings.collapsedGroups['Ungrouped'] !== false;
        ungroupedDetails.addEventListener('toggle', () => {
            this.settings.collapsedGroups['Ungrouped'] = ungroupedDetails.open;
            this.saveSettings(false);
        });
        const ungroupedSummary = document.createElement('summary');
        ungroupedSummary.className = 'my-org-summary';
        ungroupedSummary.innerText = 'Ungrouped';
        ungroupedDetails.appendChild(ungroupedSummary);

        let ungroupedCount = 0;
        let foldersInserted = false;

        pluginItems.forEach(item => {
            const name = item.innerText.trim();
            const isCommunityPlugin = pluginNames.some(pName => name.includes(pName) || pName.includes(name));
            if (!isCommunityPlugin) return;
            if (item.classList.contains('my-org-hidden')) return;

            if (!foldersInserted) {
                groupsMap.forEach(g => targetContainer.insertBefore(g.element, item));
                if (this.settings.showUngrouped) targetContainer.insertBefore(ungroupedDetails, item);
                foldersInserted = true;
            }

            let matched = false;
            for (const group of groupsMap) {
                if (group.keywords.some(k => name.toLowerCase().includes(k))) {
                    const config = group.items.find(i => i.name === name);
                    const displayName = (config && config.alias) ? config.alias : name;

                    // Pass the real name to createProxy
                    const proxy = this.createProxy(displayName, name, item, targetContainer);
                    group.element.appendChild(proxy);
                    group.proxies.push({ name: name, element: proxy });

                    item.classList.add('my-org-hidden');
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                if (this.settings.showUngrouped) {
                    // Pass the real name to createProxy
                    const proxy = this.createProxy(name, name, item, targetContainer);
                    ungroupedDetails.appendChild(proxy);
                    ungroupedCount++;
                    item.classList.add('my-org-hidden');
                } else {
                    item.classList.add('my-org-hidden');
                }
            }
        });

        groupsMap.forEach(group => {
            if (group.proxies.length === 0) {
                group.element.remove();
                return;
            }
            const definedOrder = group.items.map(i => i.name);
            group.proxies.sort((a, b) => {
                const idxA = definedOrder.indexOf(a.name);
                const idxB = definedOrder.indexOf(b.name);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return 0;
            });
            group.proxies.forEach(p => group.element.appendChild(p.element));
        });

        if (this.settings.showUngrouped) {
            if (ungroupedCount > 0) ungroupedSummary.innerText = `Ungrouped (${ungroupedCount})`;
            else ungroupedDetails.remove();
        }

        // Reset flag after operation completes
        // setTimeout ensures DOM has settled
        setTimeout(() => {
            this.isOrganizing = false;
        }, 0);
    }

    createProxy(displayName, realName, originalItem, container) {
        const proxy = document.createElement('div');
        proxy.className = 'my-org-proxy';
        proxy.innerText = displayName;

        // Check if originalItem is still in DOM and active for initial styling
        if (originalItem && originalItem.classList.contains('is-active')) {
            proxy.classList.add('is-active');
        }

        proxy.onclick = (e) => {
            e.stopPropagation();

            // Immediate visual feedback for responsiveness
            container.querySelectorAll('.my-org-proxy').forEach(p => p.classList.remove('is-active'));
            proxy.classList.add('is-active');

            // Find the current live element in the DOM instead of relying on potentially detached original references
            const freshTarget = Array.from(container.querySelectorAll('.vertical-tab-nav-item'))
                .find(el => el.innerText.trim() === realName && !el.classList.contains('my-org-proxy'));

            if (freshTarget) {
                freshTarget.click();
            } else {
                // Fallback to original reference if the fresh element isn't found
                if (originalItem) originalItem.click();
            }
        };
        return proxy;
    }
}

class GroupConfigModal extends obsidian.Modal {
    constructor(app, plugin, groupIndex) {
        super(app);
        this.plugin = plugin;
        this.groupIndex = groupIndex;
        this.group = this.plugin.settings.groups[groupIndex];
        this.listContainer = null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: `Edit items: ${this.group.title}` });
        contentEl.createEl('p', { text: 'Click arrows to reorder. Type to rename.', style: 'font-size: 0.8em; color: var(--text-muted);' });

        if (!this.app.plugins || !this.app.plugins.manifests) return;
        const allPlugins = Object.values(this.app.plugins.manifests).map(m => m.name);
        const keywords = this.group.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

        const matchingPlugins = allPlugins.filter(name =>
            keywords.some(k => name.toLowerCase().includes(k))
        );

        let currentItems = this.group.items || [];
        currentItems = currentItems.filter(i => matchingPlugins.includes(i.name));
        matchingPlugins.forEach(name => {
            if (!currentItems.find(i => i.name === name)) {
                currentItems.push({ name: name, alias: '' });
            }
        });
        this.items = currentItems;
        this.listContainer = contentEl.createDiv({ cls: 'my-org-modal-list' });
        this.renderList();

        const btnDiv = contentEl.createDiv({ style: 'margin-top: 20px; display: flex; justify-content: flex-end;' });
        const resetBtn = btnDiv.createEl('button', { text: 'Reset Defaults', cls: 'my-org-btn-reset' });
        resetBtn.style.marginRight = 'auto';
        resetBtn.onclick = () => {
            this.items.sort((a, b) => a.name.localeCompare(b.name));
            this.items.forEach(i => i.alias = '');
            this.renderList();
        };

        const saveBtn = btnDiv.createEl('button', { text: 'Save Changes', cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            this.plugin.settings.groups[this.groupIndex].items = this.items;
            await this.plugin.saveSettings(true);
            this.close();
        };
    }

    renderList() {
        this.listContainer.empty();
        if (this.items.length === 0) {
            this.listContainer.createDiv({ text: 'No plugins found matching keywords.', style: 'color: var(--text-muted); font-style: italic;' });
            return;
        }

        this.items.forEach((item, index) => {
            const row = this.listContainer.createDiv({ cls: 'my-org-modal-item' });
            const ctrls = row.createDiv({ cls: 'my-org-modal-controls' });

            const upBtn = ctrls.createEl('div', { cls: 'my-org-modal-btn', text: '▲' });
            upBtn.onclick = () => {
                if (index > 0) {
                    [this.items[index - 1], this.items[index]] = [this.items[index], this.items[index - 1]];
                    this.renderList();
                }
            };
            if (index === 0) upBtn.style.opacity = '0.3';

            const downBtn = ctrls.createEl('div', { cls: 'my-org-modal-btn', text: '▼' });
            downBtn.onclick = () => {
                if (index < this.items.length - 1) {
                    [this.items[index + 1], this.items[index]] = [this.items[index], this.items[index + 1]];
                    this.renderList();
                }
            };
            if (index === this.items.length - 1) downBtn.style.opacity = '0.3';

            row.createDiv({ cls: 'my-org-modal-item-name', text: item.name, title: item.name });
            row.createDiv({ cls: 'my-org-modal-arrow', text: '→' });

            const input = row.createEl('input', { type: 'text', placeholder: 'Alias...' });
            input.value = item.alias || '';
            input.onchange = (e) => {
                this.items[index].alias = e.target.value;
            };
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class MyOrganizerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Sidebar Group Organizer' });

        new obsidian.Setting(containerEl)
            .setName('Show Ungrouped Plugins')
            .setDesc('Move plugins that do not match any group into a special "Ungrouped" folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUngrouped)
                .onChange(async (value) => {
                    this.plugin.settings.showUngrouped = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Collapsible Sidebar Headers')
            .setDesc('Allow collapsing "Options", "Core plugins", and "Community plugins".')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.collapsibleHeaders)
                .onChange(async (value) => {
                    this.plugin.settings.collapsibleHeaders = value;
                    await this.plugin.saveSettings();
                    if (!value) {
                        document.querySelectorAll('.is-collapsed').forEach(el => el.classList.remove('is-collapsed'));
                    }
                    this.plugin.addStyle();
                }));

        new obsidian.Setting(containerEl)
            .setName('Compact Mode')
            .setDesc('Moves "Core plugins" and "Community plugins" buttons from the Options list to their respective section headers.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.compactMode)
                .onChange(async (value) => {
                    this.plugin.settings.compactMode = value;
                    await this.plugin.saveSettings(false);
                    this.plugin.addStyle();
                    this.plugin.checkAndApply();
                }));

        containerEl.createEl('hr');
        containerEl.createEl('h3', { text: 'Your Groups' });

        this.plugin.settings.groups.forEach((group, index) => {
            const div = containerEl.createDiv();
            div.style.border = '1px solid var(--background-modifier-border)';
            div.style.padding = '10px'; div.style.marginBottom = '10px';
            div.style.borderRadius = '5px';

            const headerSetting = new obsidian.Setting(div)
                .setName(`Group ${index + 1}`)
                .setHeading();

            headerSetting.addExtraButton(b => {
                b.setIcon('settings')
                    .setTooltip('Manage Items (Rename & Reorder)')
                    .onClick(() => {
                        new GroupConfigModal(this.app, this.plugin, index).open();
                    });
            });

            headerSetting.addExtraButton(b => {
                b.setIcon('arrow-up')
                    .setTooltip('Move Group Up')
                    .setDisabled(index === 0)
                    .onClick(async () => {
                        if (index > 0) {
                            const temp = this.plugin.settings.groups[index - 1];
                            this.plugin.settings.groups[index - 1] = this.plugin.settings.groups[index];
                            this.plugin.settings.groups[index] = temp;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    });
            });

            headerSetting.addExtraButton(b => {
                b.setIcon('arrow-down')
                    .setTooltip('Move Group Down')
                    .setDisabled(index === this.plugin.settings.groups.length - 1)
                    .onClick(async () => {
                        if (index < this.plugin.settings.groups.length - 1) {
                            const temp = this.plugin.settings.groups[index + 1];
                            this.plugin.settings.groups[index + 1] = this.plugin.settings.groups[index];
                            this.plugin.settings.groups[index] = temp;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    });
            });

            headerSetting.addExtraButton(b => b.setIcon('trash').setTooltip('Delete Group').onClick(async () => {
                this.plugin.settings.groups.splice(index, 1);
                delete this.plugin.settings.collapsedGroups[group.title];
                await this.plugin.saveSettings();
                this.display();
            }));

            new obsidian.Setting(div).setName('Title').addText(t => t.setValue(group.title).onChange(async v => {
                const oldState = this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                delete this.plugin.settings.collapsedGroups[this.plugin.settings.groups[index].title];
                if (oldState !== undefined) this.plugin.settings.collapsedGroups[v] = oldState;

                this.plugin.settings.groups[index].title = v;
                await this.plugin.saveSettings();
            }));

            new obsidian.Setting(div).setName('Keywords').addTextArea(t => t.setValue(group.keywords).onChange(async v => {
                this.plugin.settings.groups[index].keywords = v;
                await this.plugin.saveSettings();
            }));
        });

        const btnDiv = containerEl.createDiv({ cls: 'my-org-add-group-container' });
        const btn = btnDiv.createEl('button', { text: '+ Add Group', cls: 'mod-cta' });
        btn.style.width = '200px';
        btn.onclick = async () => {
            this.plugin.settings.groups.push({ title: 'New Folder', keywords: '', items: [] });
            await this.plugin.saveSettings();
            this.display();
        };
    }
}