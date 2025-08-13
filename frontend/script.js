const categories = {
    'produce': { name: 'PRODUCE', items: [] },
    'dairy': { name: 'DAIRY', items: [] },
    'meat': { name: 'MEAT & SEAFOOD', items: [] },
    'pantry': { name: 'PANTRY', items: [] },
    'frozen': { name: 'FROZEN', items: [] },
    'bakery': { name: 'BAKERY', items: [] },
    'beverages': { name: 'BEVERAGES', items: [] },
    'snacks': { name: 'SNACKS', items: [] },
    'household': { name: 'HOUSEHOLD', items: [] },
    'health': { name: 'HEALTH & BEAUTY', items: [] }
};

// Configuration
const API_BASE_URL = 'http://localhost:3001/api';

// State
let itemId = 0;
let currentFilter = 'all';
let currentUser = null;
let isSelectionMode = false;
let selectedItems = new Set();
let authToken = localStorage.getItem('authToken');
let selectedSuggestionIndex = -1;
let currentListId = null;
let currentListPermission = null; // 'read', 'write', or 'admin'
let currentListIsOwner = false;
let userShoppingLists = [];

// Auto-update system
let pollingIntervalId = null;
let lastListUpdate = null;
let lastNotificationUpdate = null;
let pollingPaused = false;
const POLLING_INTERVAL = 2000; // 2 seconds for testing
let isEditingList = false;
let editingListId = null;

// Legacy localStorage memory (will be migrated to DB)
let groceryMemory = JSON.parse(localStorage.getItem('groceryMemory')) || {};

// Authentication Functions
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        ...options
    };

    try {
        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API Request failed:', error);
        
        if (error.message.includes('401') || error.message.includes('Invalid token')) {
            logout();
        }
        
        throw error;
    }
}

function showAuthModal() {
    console.log('Showing auth modal...');
    document.getElementById('authOverlay').style.display = 'flex';
}

function hideAuthModal() {
    console.log('Hiding auth modal...');
    document.getElementById('authOverlay').style.display = 'none';
    clearAuthError();
    clearAuthSuccess();
}

function showAuthError(message) {
    const errorEl = document.getElementById('authError');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function clearAuthError() {
    const errorEl = document.getElementById('authError');
    errorEl.style.display = 'none';
}

function showAuthSuccess(message) {
    const successEl = document.getElementById('authSuccess');
    successEl.textContent = message;
    successEl.style.display = 'block';
}

function clearAuthSuccess() {
    const successEl = document.getElementById('authSuccess');
    successEl.style.display = 'none';
}

function switchToLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('authTitle').textContent = 'Welcome Back';
    document.getElementById('authSubtitle').textContent = 'Sign in to access your shopping lists';
    clearAuthError();
    clearAuthSuccess();
}

function switchToRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('authTitle').textContent = 'Create Account';
    document.getElementById('authSubtitle').textContent = 'Sign up to start organizing your groceries';
    clearAuthError();
    clearAuthSuccess();
}

async function login(email, password) {
    try {
        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        authToken = response.token;
        currentUser = response.user;
        localStorage.setItem('authToken', authToken);
        
        // Clear forms
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        
        // Hide modal immediately
        hideAuthModal();
        
        // Then initialize app - but don't show modal on error since we just logged in
        await initializeApp(true);
        
    } catch (error) {
        showAuthError(error.message);
    }
}

async function register(username, email, password) {
    try {
        const response = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password })
        });

        // Show success message and switch to login
        clearAuthError();
        showAuthSuccess(`Account created successfully! Please sign in with your email: ${response.user.email}`);
        
        // Clear the registration form
        document.getElementById('registerUsername').value = '';
        document.getElementById('registerEmail').value = '';
        document.getElementById('registerPassword').value = '';
        
        // Switch to login form (but keep success message visible)
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('authTitle').textContent = 'Welcome Back';
        document.getElementById('authSubtitle').textContent = 'Sign in to access your shopping lists';
        
        // Pre-fill email in login form
        document.getElementById('loginEmail').value = response.user.email;
        
    } catch (error) {
        showAuthError(error.message);
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    currentListId = null;
    localStorage.removeItem('authToken');
    
    // Stop auto-update polling
    stopAutoUpdate();
    
    // Reset polling timestamps
    lastListUpdate = null;
    lastNotificationUpdate = null;
    
    // Clear UI
    categories.produce.items = [];
    categories.dairy.items = [];
    categories.meat.items = [];
    categories.pantry.items = [];
    categories.frozen.items = [];
    categories.bakery.items = [];
    categories.beverages.items = [];
    categories.snacks.items = [];
    categories.household.items = [];
    categories.health.items = [];
    
    renderCategories();
    updateStats();
    renderMemoryStats();
    renderFrequentItems();
    
    showAuthModal();
}

async function loadGroceryMemory() {
    try {
        const response = await apiRequest('/groceries/memory?limit=100');
        groceryMemory = {};
        
        response.groceries.forEach(item => {
            groceryMemory[item.name.toLowerCase()] = {
                name: item.name,
                category: item.category,
                priority: item.priority,
                count: item.usage_count,
                lastUsed: new Date(item.last_used).getTime()
            };
        });
        
        renderMemoryStats();
        renderFrequentItems();
    } catch (error) {
        console.error('Failed to load grocery memory:', error);
    }
}

async function loadUserShoppingLists() {
    console.log('Loading shopping lists...');
    const listsResponse = await apiRequest('/lists');
    userShoppingLists = listsResponse.lists;
    return userShoppingLists;
}

async function loadShoppingList() {
    try {
        await loadUserShoppingLists();
        
        console.log('User lists:', userShoppingLists);
        
        if (!userShoppingLists || userShoppingLists.length === 0) {
            console.log('No lists found, creating default list...');
            // Create default list
            const newListResponse = await apiRequest('/lists', {
                method: 'POST',
                body: JSON.stringify({ name: 'My Shopping List' })
            });
            userShoppingLists.push(newListResponse.list);
            currentListId = newListResponse.list.id;
            populateListSelector();
            console.log('Created new list with ID:', currentListId);
        } else {
            // Set current list: use default if available, otherwise first one
            if (!currentListId) {
                if (userDefaultListId && userShoppingLists.find(list => list.id === userDefaultListId)) {
                    currentListId = userDefaultListId;
                    console.log('Using default list with ID:', currentListId);
                } else {
                    currentListId = userShoppingLists[0].id;
                    console.log('Using first list with ID:', currentListId);
                }
            }
        }
        
        // Populate list selector now that currentListId is set
        populateListSelector();
        
        // Ensure currentListId is set
        if (!currentListId) {
            throw new Error('Failed to get or create shopping list ID');
        }
        
        // Load list items
        console.log('Loading items for list:', currentListId);
        const listResponse = await apiRequest(`/lists/${currentListId}`);
        const list = listResponse.list;
        
        // Store permission information
        currentListPermission = list.user_permission || 'read';
        currentListIsOwner = list.is_owner || false;
        console.log('Current list permissions:', { permission: currentListPermission, isOwner: currentListIsOwner });
        
        // Initialize last update timestamp
        lastListUpdate = new Date(list.updated_at).getTime();
        
        // Update UI based on permissions
        updateUIBasedOnPermissions();
        
        console.log('Loaded list:', list);
        
        // Clear existing items
        Object.keys(categories).forEach(cat => {
            categories[cat].items = [];
        });
        
        // Populate items from database
        if (list.items && list.items.length > 0) {
            console.log('Populating', list.items.length, 'items');
            list.items.forEach(item => {
                if (categories[item.category]) {
                    categories[item.category].items.push({
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity,
                        priority: item.priority,
                        notes: item.notes || '',
                        completed: item.completed
                    });
                }
            });
        } else {
            console.log('No items found in list');
        }
        
        renderCategories();
        updateStats();
        
        console.log('Shopping list loaded successfully, currentListId:', currentListId);
        
    } catch (error) {
        console.error('Failed to load shopping list:', error);
        currentListId = null;
        throw error; // Re-throw so initializeApp knows there was an error
    }
}

// Shopping List Management Functions
function populateListSelector() {
    // Header elements (new location)
    const headerMyListsContainer = document.getElementById('headerMyListsContainer');
    const headerSharedListsContainer = document.getElementById('headerSharedListsContainer');
    const headerMyListsCount = document.getElementById('headerMyListsCount');
    const headerSharedListsCount = document.getElementById('headerSharedListsCount');
    const headerCurrentListActions = document.getElementById('headerCurrentListActions');
    
    // Legacy sidebar elements (for compatibility)
    const myListsContainer = document.getElementById('myListsContainer');
    const sharedListsContainer = document.getElementById('sharedListsContainer');
    const myListsCount = document.getElementById('myListsCount');
    const sharedListsCount = document.getElementById('sharedListsCount');
    const currentListActions = document.getElementById('currentListActions');
    
    // Check if header elements exist (prioritize header)
    if (!headerMyListsContainer || !headerSharedListsContainer) {
        console.warn('Header list container elements not found');
        return;
    }
    
    // Clear existing content
    headerMyListsContainer.innerHTML = '';
    headerSharedListsContainer.innerHTML = '';
    
    // Clear legacy sidebar elements if they exist
    if (myListsContainer) myListsContainer.innerHTML = '';
    if (sharedListsContainer) sharedListsContainer.innerHTML = '';
    
    if (!userShoppingLists || userShoppingLists.length === 0) {
        headerMyListsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 0.5rem; font-size: 0.75rem;">No lists yet</div>';
        headerMyListsCount.textContent = '0';
        headerSharedListsCount.textContent = '0';
        headerCurrentListActions.style.display = 'none';
        
        // Update current list indicator
        updateCurrentListIndicator();
        return;
    }
    
    // Separate owned and shared lists
    const ownedLists = userShoppingLists.filter(list => list.role === 'owner');
    const sharedLists = userShoppingLists.filter(list => list.role !== 'owner');
    
    // Sort owned lists - default first, then by name
    ownedLists.sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return a.name.localeCompare(b.name);
    });
    
    // Sort shared lists by name
    sharedLists.sort((a, b) => a.name.localeCompare(b.name));
    
    // Update counts
    headerMyListsCount.textContent = ownedLists.length.toString();
    headerSharedListsCount.textContent = sharedLists.length.toString();
    
    // Update legacy sidebar counts if they exist
    if (myListsCount) myListsCount.textContent = ownedLists.length.toString();
    if (sharedListsCount) sharedListsCount.textContent = sharedLists.length.toString();
    
    // Render owned lists
    ownedLists.forEach(list => {
        const listElement = createHeaderListElement(list, true);
        headerMyListsContainer.appendChild(listElement);
    });
    
    // Render shared lists  
    sharedLists.forEach(list => {
        const listElement = createHeaderListElement(list, false);
        headerSharedListsContainer.appendChild(listElement);
    });
    
    // Show empty states if needed
    if (ownedLists.length === 0) {
        headerMyListsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 0.5rem; font-size: 0.75rem;">No owned lists</div>';
    }
    
    if (sharedLists.length === 0) {
        headerSharedListsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 0.5rem; font-size: 0.75rem;">No shared lists</div>';
    }
    
    // Update current list indicator and actions
    updateCurrentListIndicator();
    updateHeaderCurrentListActions();
}

function createListElement(list, isOwned) {
    const listElement = document.createElement('div');
    listElement.className = `list-item ${list.id === currentListId ? 'active' : ''}`;
    listElement.onclick = () => selectList(list.id);
    
    // Create badges
    const badges = [];
    if (list.is_default) {
        badges.push('<span class="list-badge default">Default</span>');
    }
    
    if (isOwned) {
        // For owned lists, show if they're shared or private
        if (list.is_shared) {
            badges.push('<span class="list-badge shared">Shared</span>');
        } else {
            badges.push('<span class="list-badge private">Private</span>');
        }
    } else {
        // For shared lists, show permission level
        const permission = list.role || 'read';
        badges.push(`<span class="list-badge shared">${permission}</span>`);
    }
    
    // Create meta info
    let metaInfo = `${list.item_count || 0} items`;
    if (list.completed_count > 0) {
        metaInfo += ` • ${list.completed_count} done`;
    }
    
    if (!isOwned && list.owner_username) {
        metaInfo += ` • by ${list.owner_username}`;
    }
    
    listElement.innerHTML = `
        <div class="list-item-info">
            <div class="list-item-name">${list.name}</div>
            <div class="list-item-meta">${metaInfo}</div>
        </div>
        <div class="list-item-badges">
            ${badges.join('')}
        </div>
    `;
    
    return listElement;
}

function createHeaderListElement(list, isOwned) {
    const listElement = document.createElement('div');
    listElement.className = `dropdown-list-item ${list.id === currentListId ? 'active' : ''}`;
    listElement.onclick = () => selectHeaderList(list.id);
    
    // Create badges
    const badges = [];
    if (list.is_default) {
        badges.push('<span class="list-badge default">Default</span>');
    }
    
    if (isOwned) {
        // For owned lists, show if they're shared or private
        if (list.is_shared) {
            badges.push('<span class="list-badge shared">Shared</span>');
        } else {
            badges.push('<span class="list-badge private">Private</span>');
        }
    } else {
        // For shared lists, show permission level
        const permission = list.role || 'read';
        badges.push(`<span class="list-badge shared">${permission}</span>`);
    }
    
    // Create meta info
    let metaInfo = `${list.item_count || 0} items`;
    if (list.completed_count > 0) {
        metaInfo += ` • ${list.completed_count} done`;
    }
    
    if (!isOwned && list.owner_username) {
        metaInfo += ` • by ${list.owner_username}`;
    }
    
    listElement.innerHTML = `
        <div class="dropdown-list-item-info">
            <div class="dropdown-list-item-name">${list.name}</div>
            <div class="dropdown-list-item-meta">${metaInfo}</div>
        </div>
        <div class="dropdown-list-item-badges">
            ${badges.join('')}
        </div>
    `;
    
    return listElement;
}

function selectHeaderList(listId) {
    if (listId === currentListId) {
        // Close dropdown if same list selected
        toggleShoppingListDropdown();
        return;
    }
    
    console.log('Selecting header list:', listId);
    
    // Update currentListId directly and call switch
    currentListId = listId;
    
    // Update old selector if it exists (for compatibility)
    const oldSelector = document.getElementById('listSelector');
    if (oldSelector) {
        oldSelector.value = listId.toString();
    }
    
    // Close dropdown
    toggleShoppingListDropdown();
    
    // Call the switch function
    switchToList(listId);
}

function selectList(listId) {
    if (listId === currentListId) return;
    
    console.log('Selecting list:', listId);
    
    // Update currentListId directly and call switch
    currentListId = listId;
    
    // Update old selector if it exists (for compatibility)
    const oldSelector = document.getElementById('listSelector');
    if (oldSelector) {
        oldSelector.value = listId.toString();
    }
    
    // Call the switch function
    switchToList(listId);
}

function updateCurrentListIndicator() {
    const currentListIndicator = document.getElementById('currentListIndicator');
    
    if (!currentListId || !userShoppingLists) {
        if (currentListIndicator) {
            currentListIndicator.textContent = 'Select List';
        }
        return;
    }
    
    const currentList = userShoppingLists.find(list => list.id === currentListId);
    if (currentListIndicator && currentList) {
        currentListIndicator.textContent = currentList.name;
    }
}

function updateHeaderCurrentListActions() {
    const headerCurrentListActions = document.getElementById('headerCurrentListActions');
    const headerCurrentListName = document.getElementById('headerCurrentListName');
    const headerCurrentListBadges = document.getElementById('headerCurrentListBadges');
    const headerRenameListBtn = document.getElementById('headerRenameListBtn');
    const headerDeleteListBtn = document.getElementById('headerDeleteListBtn');
    const headerDefaultListBtn = document.getElementById('headerDefaultListBtn');
    const headerSharingBtn = document.getElementById('headerSharingBtn');
    
    if (!currentListId || !userShoppingLists) {
        if (headerCurrentListActions) {
            headerCurrentListActions.style.display = 'none';
        }
        return;
    }
    
    const currentList = userShoppingLists.find(list => list.id === currentListId);
    if (!currentList) {
        if (headerCurrentListActions) {
            headerCurrentListActions.style.display = 'none';
        }
        return;
    }
    
    // Show current list actions
    if (headerCurrentListActions) {
        headerCurrentListActions.style.display = 'block';
    }
    
    if (headerCurrentListName) {
        headerCurrentListName.textContent = currentList.name;
    }
    
    // Update badges
    const badges = [];
    if (currentList.is_default) {
        badges.push('<span class="list-badge default">Default</span>');
    }
    
    const isOwned = currentList.role === 'owner';
    if (isOwned) {
        if (currentList.is_shared) {
            badges.push('<span class="list-badge shared">Shared</span>');
        } else {
            badges.push('<span class="list-badge private">Private</span>');
        }
    } else {
        badges.push(`<span class="list-badge shared">${currentList.role}</span>`);
    }
    
    if (headerCurrentListBadges) {
        headerCurrentListBadges.innerHTML = badges.join('');
    }
    
    // Enable/disable action buttons based on permissions
    const hasSelection = !!currentListId;
    const canManage = canManageList();
    
    if (headerRenameListBtn) headerRenameListBtn.disabled = !canManage;
    if (headerDeleteListBtn) headerDeleteListBtn.disabled = !canManage || userShoppingLists.length <= 1;
    if (headerDefaultListBtn) headerDefaultListBtn.disabled = !canManage;
    if (headerSharingBtn) headerSharingBtn.disabled = !canShareList();
    
    // Update default button appearance
    const isCurrentDefault = currentList && currentList.is_default;
    
    if (headerDefaultListBtn) {
        if (hasSelection && isCurrentDefault) {
            headerDefaultListBtn.textContent = '★'; // Filled star for default
            headerDefaultListBtn.title = 'Remove as default';
            headerDefaultListBtn.style.color = '#ffd700'; // Gold color
        } else {
            headerDefaultListBtn.textContent = '⭐'; // Outline star
            headerDefaultListBtn.title = 'Set as default';
            headerDefaultListBtn.style.color = ''; // Reset color
        }
    }
}

function toggleShoppingListDropdown() {
    const dropdown = document.getElementById('shoppingListDropdown');
    if (dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            // Dropdown was just opened, refresh the list
            populateListSelector();
        }
    }
}

function toggleMemorySection() {
    const memoryContent = document.getElementById('memoryContent');
    const memoryChevron = document.getElementById('memoryChevron');
    
    if (memoryContent && memoryChevron) {
        const isHidden = memoryContent.style.display === 'none';
        memoryContent.style.display = isHidden ? 'block' : 'none';
        memoryChevron.classList.toggle('rotated', isHidden);
    }
}

async function switchToList(listId) {
    console.log('Switching to list:', listId);
    
    try {
        // Load the new list's items
        const listResponse = await apiRequest(`/lists/${listId}`);
        const list = listResponse.list;
        
        // Store permission information
        currentListPermission = list.user_permission || 'read';
        currentListIsOwner = list.is_owner || false;
        console.log('Updated list permissions:', { permission: currentListPermission, isOwner: currentListIsOwner });
        
        // Update last update timestamp for new list
        lastListUpdate = new Date(list.updated_at).getTime();
        
        // Update UI based on permissions
        updateUIBasedOnPermissions();
        
        console.log('Processing list:', list.name, 'with', list.items ? list.items.length : 0, 'items');
        
        // Clear existing items
        Object.keys(categories).forEach(cat => {
            categories[cat].items = [];
        });
        
        // Populate items from database
        if (list.items && list.items.length > 0) {
            console.log('Adding items to categories...');
            list.items.forEach(item => {
                if (categories[item.category]) {
                    categories[item.category].items.push({
                        id: item.id,
                        name: item.name,
                        quantity: item.quantity,
                        priority: item.priority,
                        notes: item.notes || '',
                        completed: item.completed
                    });
                }
            });
        }
        
        // Update UI
        updateDisplay();
        updateStats();
        populateListSelector(); // Update list selection and button states
        
        console.log('Successfully switched to list:', list.name);
        
    } catch (error) {
        console.error('Failed to switch to list:', error);
        alert(`Failed to load shopping list: ${error.message}`);
    }
}

function updateCurrentListActions() {
    const currentListActions = document.getElementById('currentListActions');
    const currentListName = document.getElementById('currentListName');
    const currentListBadges = document.getElementById('currentListBadges');
    const renameBtn = document.getElementById('renameListBtn');
    const deleteBtn = document.getElementById('deleteListBtn');
    const defaultBtn = document.getElementById('defaultListBtn');
    const sharingBtn = document.getElementById('sharingBtn');
    
    if (!currentListId || !userShoppingLists) {
        currentListActions.style.display = 'none';
        return;
    }
    
    const currentList = userShoppingLists.find(list => list.id === currentListId);
    if (!currentList) {
        currentListActions.style.display = 'none';
        return;
    }
    
    // Show current list actions
    currentListActions.style.display = 'block';
    currentListName.textContent = currentList.name;
    
    // Update badges
    const badges = [];
    if (currentList.is_default) {
        badges.push('<span class="list-badge default">Default</span>');
    }
    
    const isOwned = currentList.role === 'owner';
    if (isOwned) {
        if (currentList.is_shared) {
            badges.push('<span class="list-badge shared">Shared</span>');
        } else {
            badges.push('<span class="list-badge private">Private</span>');
        }
    } else {
        badges.push(`<span class="list-badge shared">${currentList.role}</span>`);
    }
    
    currentListBadges.innerHTML = badges.join('');
    
    // Enable/disable action buttons based on permissions
    const hasSelection = !!currentListId;
    const canManage = canManageList();
    
    renameBtn.disabled = !canManage;
    deleteBtn.disabled = !canManage || userShoppingLists.length <= 1;
    defaultBtn.disabled = !canManage;
    sharingBtn.disabled = !canShareList();
    
    // Update default button appearance
    const isCurrentDefault = currentList && currentList.is_default;
    
    if (hasSelection && isCurrentDefault) {
        defaultBtn.textContent = '★'; // Filled star for default
        defaultBtn.title = 'Remove as default';
        defaultBtn.style.color = '#ffd700'; // Gold color
    } else {
        defaultBtn.textContent = '⭐'; // Outline star
        defaultBtn.title = 'Set as default';
        defaultBtn.style.color = ''; // Reset color
    }
}

async function switchShoppingList() {
    const selector = document.getElementById('listSelector');
    const newListId = selector ? parseInt(selector.value) : currentListId;
    
    if (newListId && newListId !== currentListId) {
        currentListId = newListId;
        console.log('Switching to list:', currentListId);
        
        try {
            console.log('Making API request to load list:', currentListId);
            // Load the new list's items
            const listResponse = await apiRequest(`/lists/${currentListId}`);
            console.log('List response received:', listResponse);
            
            if (!listResponse || !listResponse.list) {
                throw new Error('Invalid response from server: ' + JSON.stringify(listResponse));
            }
            
            const list = listResponse.list;
            
            // Store permission information
            currentListPermission = list.user_permission || 'read';
            currentListIsOwner = list.is_owner || false;
            console.log('Updated list permissions:', { permission: currentListPermission, isOwner: currentListIsOwner });
            
            // Update last update timestamp for new list
            lastListUpdate = new Date(list.updated_at).getTime();
            
            // Update UI based on permissions
            updateUIBasedOnPermissions();
            
            console.log('Processing list:', list.name, 'with', list.items ? list.items.length : 0, 'items');
            
            // Clear existing items
            Object.keys(categories).forEach(cat => {
                categories[cat].items = [];
            });
            
            // Populate items from database
            if (list.items && list.items.length > 0) {
                console.log('Adding items to categories...');
                list.items.forEach(item => {
                    console.log('Processing item:', item.name, 'category:', item.category);
                    if (categories[item.category]) {
                        categories[item.category].items.push({
                            id: item.id,
                            name: item.name,
                            quantity: item.quantity,
                            priority: item.priority,
                            notes: item.notes || '',
                            completed: item.completed
                        });
                    } else {
                        console.warn('Unknown category:', item.category, 'for item:', item.name);
                    }
                });
            } else {
                console.log('No items to add for this list');
            }
            
            // Update UI
            console.log('Updating display...');
            updateDisplay();
            updateStats();
            populateListSelector(); // Update list selection and button states
            
            console.log('Successfully switched to list:', list.name);
            
        } catch (error) {
            console.error('Failed to switch shopping list:', error);
            console.error('Error details:', error.message, error.stack);
            alert(`Failed to load shopping list: ${error.message}`);
        }
    }
}

function showNewListModal() {
    const modal = document.getElementById('listModalOverlay');
    const title = document.getElementById('listModalTitle');
    const submitBtn = document.getElementById('listFormSubmit');
    const input = document.getElementById('listNameInput');
    
    isEditingList = false;
    editingListId = null;
    
    title.textContent = 'Create New Shopping List';
    submitBtn.textContent = 'Create List';
    input.value = '';
    input.placeholder = 'Enter list name...';
    
    modal.style.display = 'flex';
    input.focus();
}

function showEditListModal() {
    if (!currentListId) return;
    
    const currentList = userShoppingLists.find(list => list.id === currentListId);
    if (!currentList) return;
    
    const modal = document.getElementById('listModalOverlay');
    const title = document.getElementById('listModalTitle');
    const submitBtn = document.getElementById('listFormSubmit');
    const input = document.getElementById('listNameInput');
    
    isEditingList = true;
    editingListId = currentListId;
    
    title.textContent = 'Rename Shopping List';
    submitBtn.textContent = 'Save Changes';
    input.value = currentList.name;
    input.placeholder = 'Enter new name...';
    
    modal.style.display = 'flex';
    input.focus();
    input.select();
}

function hideListModal() {
    const modal = document.getElementById('listModalOverlay');
    modal.style.display = 'none';
    isEditingList = false;
    editingListId = null;
}

async function confirmDeleteList() {
    if (!currentListId || userShoppingLists.length <= 1) return;
    
    const currentList = userShoppingLists.find(list => list.id === currentListId);
    if (!currentList) return;
    
    if (confirm(`Are you sure you want to delete "${currentList.name}"? This will permanently delete all items in this list.`)) {
        try {
            await apiRequest(`/lists/${currentListId}`, {
                method: 'DELETE'
            });
            
            // Remove from local array
            userShoppingLists = userShoppingLists.filter(list => list.id !== currentListId);
            
            // Switch to first remaining list
            currentListId = userShoppingLists[0].id;
            
            // Reload the current list data
            await loadShoppingList();
            
            alert('Shopping list deleted successfully');
            
        } catch (error) {
            console.error('Failed to delete shopping list:', error);
            alert('Failed to delete shopping list');
        }
    }
}

// Initialize list form handling
function initializeListFormHandling() {
    const listForm = document.getElementById('listForm');
    if (listForm) {
        // Remove existing event listeners by cloning the element
        const newListForm = listForm.cloneNode(true);
        listForm.parentNode.replaceChild(newListForm, listForm);
        
        newListForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const nameInput = document.getElementById('listNameInput');
            const listName = nameInput.value.trim();
            
            if (!listName) {
                alert('Please enter a list name');
                return;
            }
            
            try {
                if (isEditingList && editingListId) {
                    console.log('Updating list:', editingListId, 'with name:', listName);
                    // Update existing list
                    const response = await apiRequest(`/lists/${editingListId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ name: listName })
                    });
                    
                    console.log('Update response:', response);
                    
                    if (!response || !response.list) {
                        throw new Error('Invalid response when updating list: ' + JSON.stringify(response));
                    }
                    
                    // Update local array
                    const listIndex = userShoppingLists.findIndex(list => list.id === editingListId);
                    if (listIndex !== -1) {
                        userShoppingLists[listIndex] = response.list;
                        console.log('Updated local list array');
                    }
                    
                    populateListSelector();
                    hideListModal();
                    console.log('Successfully updated list:', response.list.name);
                    
                } else {
                    console.log('Creating new list with name:', listName);
                    // Create new list
                    const response = await apiRequest('/lists', {
                        method: 'POST',
                        body: JSON.stringify({ name: listName })
                    });
                    
                    console.log('Create response:', response);
                    
                    if (!response || !response.list) {
                        throw new Error('Invalid response when creating list: ' + JSON.stringify(response));
                    }
                    
                    // Add to local array
                    userShoppingLists.push(response.list);
                    console.log('Added to local list array, total lists:', userShoppingLists.length);
                    
                    // Switch to new list
                    currentListId = response.list.id;
                    console.log('Switched to new list ID:', currentListId);
                    
                    // Clear current items and update UI
                    Object.keys(categories).forEach(cat => {
                        categories[cat].items = [];
                    });
                    
                    updateDisplay();
                    updateStats();
                    populateListSelector();
                    hideListModal();
                    
                    console.log('Successfully created list:', response.list.name);
                }
                
            } catch (error) {
                console.error('Failed to save shopping list:', error);
                console.error('Error details:', error.message, error.stack);
                alert(`Failed to save shopping list: ${error.message}`);
            }
        });
    }
}

// Default list functionality
let userDefaultListId = null;

async function loadDefaultList() {
    try {
        const response = await apiRequest('/users/default-list');
        userDefaultListId = response.default_list_id;
        return userDefaultListId;
    } catch (error) {
        console.error('Failed to load default list:', error);
        return null;
    }
}

async function toggleDefaultList() {
    if (!currentListId) return;
    
    try {
        const currentList = userShoppingLists.find(list => list.id === currentListId);
        const isCurrentlyDefault = currentList && currentList.is_default;
        const newDefaultId = isCurrentlyDefault ? null : currentListId;
        
        await apiRequest('/users/default-list', {
            method: 'PUT',
            body: JSON.stringify({ list_id: newDefaultId })
        });
        
        // Update local data - mark all lists as not default, then set the new default
        userShoppingLists.forEach(list => {
            list.is_default = false;
        });
        
        if (newDefaultId) {
            const listToUpdate = userShoppingLists.find(list => list.id === newDefaultId);
            if (listToUpdate) {
                listToUpdate.is_default = true;
            }
        }
        
        populateListSelector(); // Update UI
        
        const message = newDefaultId ? 
            `"${currentList.name}" is now your default shopping list` : 
            `"${currentList.name}" is no longer your default shopping list`;
        
        console.log(message);
        
    } catch (error) {
        console.error('Failed to toggle default list:', error);
        alert(`Failed to update default list: ${error.message}`);
    }
}

async function initializeApp(skipModalOnError = false) {
    if (!authToken) {
        if (!skipModalOnError) {
            showAuthModal();
        }
        return;
    }

    try {
        console.log('Initializing app with token:', authToken ? 'present' : 'missing');
        
        // Verify token and get user info
        const response = await apiRequest('/auth/me');
        currentUser = response.user;
        
        console.log('User verified:', currentUser);
        
        // Load user data
        console.log('Loading user data...');
        try {
            await loadGroceryMemory();
        } catch (error) {
            console.warn('Failed to load grocery memory:', error);
        }
        
        // Load default list preference
        console.log('Loading default list preference...');
        await loadDefaultList();
        
        try {
            await loadShoppingList();
        } catch (error) {
            console.error('Failed to load shopping list:', error);
            // Try to create a new list if loading failed
            try {
                console.log('Attempting to create emergency list...');
                const newListResponse = await apiRequest('/lists', {
                    method: 'POST',
                    body: JSON.stringify({ name: 'My Shopping List' })
                });
                currentListId = newListResponse.list.id;
                console.log('Created emergency list with ID:', currentListId);
            } catch (createError) {
                console.error('Failed to create emergency list:', createError);
                currentListId = null;
            }
        }
        
        console.log('After loading, currentListId:', currentListId);
        
        // Initialize list form handling
        initializeListFormHandling();
        
        // Load notifications
        console.log('Loading notifications...');
        try {
            await loadNotifications();
        } catch (error) {
            console.warn('Failed to load notifications:', error);
        }
        
        // Start auto-update polling
        startAutoUpdate();
        
        console.log('App initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        if (!skipModalOnError) {
            logout();
        }
    }
}

function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    const themeToggle = document.querySelector('.theme-toggle');
    themeToggle.textContent = newTheme === 'dark' ? '🌙' : '☀️';
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    const themeToggle = document.querySelector('.theme-toggle');
    themeToggle.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
}

function adjustQuantity(delta) {
    const quantityInput = document.getElementById('itemQuantity');
    const currentValue = parseInt(quantityInput.value);
    const newValue = Math.max(1, currentValue + delta);
    quantityInput.value = newValue;
}

function saveToMemory(item) {
    const key = item.name.toLowerCase();
    if (!groceryMemory[key]) {
        groceryMemory[key] = {
            name: item.name,
            category: item.category,
            priority: item.priority,
            count: 0,
            lastUsed: Date.now()
        };
    }
    
    groceryMemory[key].count++;
    groceryMemory[key].lastUsed = Date.now();
    groceryMemory[key].category = item.category;
    groceryMemory[key].priority = item.priority;
    
    localStorage.setItem('groceryMemory', JSON.stringify(groceryMemory));
    renderMemoryStats();
    renderFrequentItems();
}

function getAutocompleteItems(query) {
    if (!query || query.length < 2) return [];
    
    const queryLower = query.toLowerCase();
    return Object.values(groceryMemory)
        .filter(item => item.name.toLowerCase().includes(queryLower))
        .sort((a, b) => {
            // Sort by usage count (descending) then by last used (descending)
            if (b.count !== a.count) return b.count - a.count;
            return b.lastUsed - a.lastUsed;
        })
        .slice(0, 8);
}

function showAutocompleteSuggestions(suggestions) {
    const container = document.getElementById('autocompleteSuggestions');
    
    if (suggestions.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.innerHTML = suggestions.map((item, index) => `
        <div class="autocomplete-suggestion" data-index="${index}" onclick="selectSuggestion(${index})">
            <div class="suggestion-main">
                <div class="suggestion-name">${item.name}</div>
                <div class="suggestion-meta">${categories[item.category]?.name || item.category} • ${item.priority} priority</div>
            </div>
            <div class="suggestion-count">${item.count}x</div>
        </div>
    `).join('');
    
    container.style.display = 'block';
    selectedSuggestionIndex = -1;
}

function selectSuggestion(index) {
    const suggestions = getAutocompleteItems(document.getElementById('itemName').value);
    if (index >= 0 && index < suggestions.length) {
        const item = suggestions[index];
        
        document.getElementById('itemName').value = item.name;
        document.getElementById('itemCategory').value = item.category;
        document.getElementById('itemPriority').value = item.priority;
        
        hideSuggestions();
    }
}

function hideSuggestions() {
    document.getElementById('autocompleteSuggestions').style.display = 'none';
    selectedSuggestionIndex = -1;
}

function renderMemoryStats() {
    const totalItems = Object.keys(groceryMemory).length;
    const totalUsage = Object.values(groceryMemory).reduce((sum, item) => sum + item.count, 0);
    
    document.getElementById('memoryStats').textContent = 
        `${totalItems} items remembered • ${totalUsage} total uses`;
}

function renderFrequentItems() {
    const container = document.getElementById('frequentItems');
    const frequentItems = Object.values(groceryMemory)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    
    if (frequentItems.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">No items in memory yet</div>';
        return;
    }
    
    container.innerHTML = frequentItems.map(item => `
        <div class="frequent-item" onclick="addFrequentItem('${item.name}', '${item.category}', '${item.priority}')">
            <div>
                <div class="frequent-item-name">${item.name}</div>
                <div class="frequent-item-meta">${categories[item.category]?.name || item.category}</div>
            </div>
            <div class="frequent-item-meta">${item.count}x</div>
        </div>
    `).join('');
}

function addFrequentItem(name, category, priority) {
    document.getElementById('itemName').value = name;
    document.getElementById('itemCategory').value = category;
    document.getElementById('itemPriority').value = priority;
    document.getElementById('itemName').focus();
}

async function addItem(event) {
    event.preventDefault();
    
    // Check permissions
    if (!canAddItems()) {
        alert('You do not have permission to add items to this list');
        return;
    }
    
    console.log('Adding item, currentListId:', currentListId);
    console.log('authToken:', authToken ? 'present' : 'missing');
    console.log('currentUser:', currentUser);
    
    if (!currentListId) {
        console.error('No currentListId available');
        console.error('Debug info:', { authToken: !!authToken, currentUser, currentListId });
        alert('No shopping list available. currentListId: ' + currentListId);
        return;
    }
    
    const name = document.getElementById('itemName').value.trim();
    const quantity = parseInt(document.getElementById('itemQuantity').value);
    const priority = document.getElementById('itemPriority').value;
    const notes = document.getElementById('itemNotes').value.trim();
    const category = document.getElementById('itemCategory').value;

    console.log('Item data:', { name, quantity, priority, notes, category });

    if (!name) {
        alert('Please enter an item name');
        return;
    }

    try {
        console.log('Making API request to add item...');
        const response = await apiRequest(`/lists/${currentListId}/items`, {
            method: 'POST',
            body: JSON.stringify({
                name,
                quantity,
                category,
                priority,
                notes
            })
        });

        console.log('API response:', response);
        const newItem = response.item;
        
        // Add to local state
        categories[category].items.push({
            id: newItem.id,
            name: newItem.name,
            quantity: newItem.quantity,
            priority: newItem.priority,
            notes: newItem.notes || '',
            completed: newItem.completed
        });
        
        console.log('Item added to local state');
        
        // Clear form
        document.getElementById('itemName').value = '';
        document.getElementById('itemQuantity').value = '1';
        document.getElementById('itemPriority').value = 'low';
        document.getElementById('itemNotes').value = '';
        
        renderCategories();
        updateStats();
        
        // Update timestamp to prevent immediate re-fetch (add small buffer to account for timing differences)
        lastListUpdate = Date.now() + 1000; // Add 1 second buffer
        
        // Refresh memory
        await loadGroceryMemory();
        
        console.log('Item added successfully');
        
    } catch (error) {
        console.error('Failed to add item:', error);
        alert('Failed to add item: ' + error.message);
    }
}

async function toggleItem(categoryId, itemId) {
    const category = categories[categoryId];
    const item = category.items.find(item => item.id === itemId);
    if (!item) return;
    
    // Optimistically update UI
    const originalCompleted = item.completed;
    item.completed = !item.completed;
    renderCategories();
    updateStats();
    
    try {
        // Call API to persist change
        const response = await apiRequest(`/lists/${currentListId}/items/${itemId}/toggle`, {
            method: 'PUT'
        });
        
        // Update with server response to ensure consistency
        item.completed = response.item.completed;
        renderCategories();
        updateStats();
        
        // Update timestamp to prevent immediate re-fetch (add small buffer to account for timing differences)
        lastListUpdate = Date.now() + 1000; // Add 1 second buffer
        
    } catch (error) {
        // Revert optimistic update on error
        item.completed = originalCompleted;
        renderCategories();
        updateStats();
        
        console.error('Failed to toggle item:', error);
        alert(`Failed to update item: ${error.message}`);
    }
}

async function updateQuantity(categoryId, itemId, delta) {
    // Check permissions
    if (!canEditItems()) {
        alert('You do not have permission to edit items in this list');
        return;
    }
    
    const category = categories[categoryId];
    const item = category.items.find(item => item.id === itemId);
    if (!item) return;
    
    const newQuantity = Math.max(1, item.quantity + delta);
    
    // Don't send request if quantity didn't change
    if (newQuantity === item.quantity) return;
    
    try {
        // Update on server
        await apiRequest(`/lists/${currentListId}/items/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: item.name,
                quantity: newQuantity,
                category: item.category || categoryId,
                priority: item.priority,
                notes: item.notes || '',
                completed: item.completed
            })
        });
        
        // Update local data only after successful server update
        item.quantity = newQuantity;
        renderCategories();
        updateStats();
        
        console.log(`Updated item ${item.name} quantity to ${newQuantity}`);
        
    } catch (error) {
        console.error('Failed to update item quantity:', error);
        alert(`Failed to update quantity: ${error.message}`);
    }
}

async function deleteItem(categoryId, itemId) {
    // Check permissions
    if (!canDeleteItems()) {
        alert('You do not have permission to delete items from this list');
        return;
    }
    
    const category = categories[categoryId];
    const item = category.items.find(item => item.id === itemId);
    if (!item) return;
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${item.name}"?`)) {
        return;
    }
    
    // Optimistically remove from UI
    const originalItems = [...category.items];
    category.items = category.items.filter(item => item.id !== itemId);
    renderCategories();
    updateStats();
    
    try {
        // Call API to persist change
        await apiRequest(`/lists/${currentListId}/items/${itemId}`, {
            method: 'DELETE'
        });
        
        // Update timestamp to prevent immediate re-fetch (add small buffer to account for timing differences)
        lastListUpdate = Date.now() + 1000; // Add 1 second buffer
        
    } catch (error) {
        // Revert optimistic update on error
        category.items = originalItems;
        renderCategories();
        updateStats();
        
        console.error('Failed to delete item:', error);
        alert(`Failed to delete item: ${error.message}`);
    }
}

function updateDisplay() {
    renderCategories();
    updateStats();
}

function updateStats() {
    const allItems = Object.values(categories).flatMap(cat => cat.items);
    const needed = allItems.filter(item => !item.completed).length;
    const purchased = allItems.filter(item => item.completed).length;
    const total = allItems.length;
    
    document.getElementById('stats').textContent = `${needed} needed • ${purchased} purchased • ${total} total`;
}

function filterItems() {
    renderCategories();
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    container.innerHTML = '';

    Object.entries(categories).forEach(([categoryId, category]) => {
        let filteredItems = category.items;
        
        // Apply search filter
        if (searchTerm) {
            filteredItems = filteredItems.filter(item => 
                item.name.toLowerCase().includes(searchTerm) ||
                item.notes.toLowerCase().includes(searchTerm) ||
                category.name.toLowerCase().includes(searchTerm)
            );
        }
        
        // Apply status filter
        if (currentFilter === 'needed') {
            filteredItems = filteredItems.filter(item => !item.completed);
        } else if (currentFilter === 'purchased') {
            filteredItems = filteredItems.filter(item => item.completed);
        }
        
        if (filteredItems.length === 0) return;

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        
        categoryDiv.innerHTML = `
            <div class="category-header">
                ${category.name}
            </div>
            <div class="items-list">
                ${filteredItems.map(item => {
                    const itemKey = `${categoryId}-${item.id}`;
                    const isSelected = selectedItems.has(itemKey);
                    
                    return `
                    <div class="item ${item.completed ? 'completed' : ''} ${isSelectionMode ? 'selection-mode' : ''} ${isSelected ? 'selected' : ''}">
                        ${isSelectionMode ? `
                            <div class="selection-area" onclick="toggleItemSelection('${categoryId}', ${item.id})"></div>
                            <input type="checkbox" class="selection-checkbox" ${isSelected ? 'checked' : ''} 
                                   onchange="toggleItemSelection('${categoryId}', ${item.id})" style="pointer-events: none;">
                        ` : `
                            <input type="checkbox" class="item-checkbox" ${item.completed ? 'checked' : ''} 
                                   onchange="toggleItem('${categoryId}', ${item.id})">
                        `}
                        <div class="item-content">
                            <div class="item-header">
                                <span class="item-name">${item.name}</span>
                                <div class="item-badges">
                                    <span class="priority-badge priority-${item.priority}">${item.priority}</span>
                                    <span class="category-badge">${category.name}</span>
                                </div>
                            </div>
                            ${item.notes ? `<div class="item-notes">${item.notes}</div>` : ''}
                        </div>
                        <div class="item-quantity">
                            <div class="quantity-controls">
                                <button class="qty-btn" onclick="updateQuantity('${categoryId}', ${item.id}, -1)" ${isSelectionMode ? 'disabled' : ''}>−</button>
                                <span class="quantity-value">${item.quantity}</span>
                                <button class="qty-btn" onclick="updateQuantity('${categoryId}', ${item.id}, 1)" ${isSelectionMode ? 'disabled' : ''}>+</button>
                            </div>
                            <span>pcs</span>
                        </div>
                        <div class="item-actions">
                            <button class="action-btn delete" onclick="deleteItem('${categoryId}', ${item.id})" ${isSelectionMode ? 'disabled' : ''}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3,6 5,6 21,6"></polyline>
                                    <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `}).join('')}
            </div>
        `;
        
        container.appendChild(categoryDiv);
    });

    if (container.innerHTML === '') {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🛒</div>
                <h3>No items found</h3>
                <p>Try adjusting your search or filters</p>
            </div>
        `;
    }
}

async function shareList() {
    // Check permissions
    if (!canShareList()) {
        alert('You do not have permission to share this list');
        return;
    }
    
    if (!currentListId) {
        alert('No shopping list selected to share');
        return;
    }

    try {
        const response = await apiRequest(`/lists/${currentListId}/share`, {
            method: 'POST'
        });

        const shareUrl = response.share_url;
        const listName = response.list_name;

        // Pause polling while share modal is open
        pausePolling();
        
        // Create a modal to show the share URL
        showShareModal(shareUrl, listName);

    } catch (error) {
        console.error('Failed to generate share link:', error);
        alert(`Failed to generate share link: ${error.message}`);
    }
}

function showShareModal(shareUrl, listName) {
    // Create modal HTML
    const modalHtml = `
        <div class="auth-overlay" id="shareModalOverlay" style="display: flex;">
            <div class="auth-modal">
                <div class="auth-header">
                    <h2 class="auth-title">Share "${listName}"</h2>
                    <p class="auth-subtitle">Anyone with this link can view and check off items</p>
                </div>
                <div class="form-group">
                    <label class="form-label">Share URL:</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" class="form-input" id="shareUrlInput" value="${shareUrl}" readonly style="flex: 1;">
                        <button type="button" class="auth-btn primary" onclick="copyShareUrl()">Copy</button>
                    </div>
                </div>
                <div class="auth-actions">
                    <button type="button" class="auth-btn secondary" onclick="hideShareModal()">Close</button>
                </div>
            </div>
        </div>
    `;

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function copyShareUrl() {
    const input = document.getElementById('shareUrlInput');
    input.select();
    document.execCommand('copy');
    
    // Give feedback
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.style.background = '#22c55e';
    
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
    }, 2000);
}

function hideShareModal() {
    const modal = document.getElementById('shareModalOverlay');
    if (modal) {
        modal.remove();
    }
    
    // Resume polling when modal closes
    setTimeout(() => {
        resumePolling();
    }, 500);
}

function legacyShareList() {
    const allItems = Object.entries(categories)
        .filter(([_, category]) => category.items.length > 0)
        .map(([_, category]) => {
            const itemsList = category.items
                .map(item => `• ${item.name} (${item.quantity}) - ${item.priority} priority${item.notes ? ` - ${item.notes}` : ''}`)
                .join('\n');
            return `${category.name}:\n${itemsList}`;
        })
        .join('\n\n');

    if (allItems) {
        const shareText = `🛒 My Shopping List\n\n${allItems}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'My Shopping List',
                text: shareText
            });
        } else {
            navigator.clipboard.writeText(shareText).then(() => {
                alert('Shopping list copied to clipboard!');
            });
        }
    } else {
        alert('Your shopping list is empty!');
    }
}

// Share dropdown functions
function toggleShareDropdown() {
    const dropdown = document.getElementById('shareDropdown');
    const isVisible = dropdown.style.display === 'block';
    
    // Close all other dropdowns
    document.querySelectorAll('.share-menu').forEach(menu => {
        if (menu !== dropdown) {
            menu.style.display = 'none';
        }
    });
    
    dropdown.style.display = isVisible ? 'none' : 'block';
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.share-dropdown')) {
        document.querySelectorAll('.share-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

// Permission helper functions
function hasWritePermission() {
    return currentListPermission === 'write' || currentListPermission === 'admin';
}

function hasAdminPermission() {
    return currentListPermission === 'admin';
}

function canAddItems() {
    return hasWritePermission();
}

function canEditItems() {
    return hasWritePermission();
}

function canDeleteItems() {
    return hasWritePermission();
}

function canShareList() {
    return hasAdminPermission(); // Only owners can share lists
}

function canManageList() {
    return hasAdminPermission(); // Only owners can rename/delete lists
}

function updateUIBasedOnPermissions() {
    console.log('Updating UI based on permissions:', { permission: currentListPermission, isOwner: currentListIsOwner });
    
    // Add item form
    const addForm = document.querySelector('.add-form');
    const addButton = document.querySelector('.add-btn');
    if (addForm && addButton) {
        if (canAddItems()) {
            addForm.style.display = 'flex';
            addButton.disabled = false;
            addButton.title = '';
        } else {
            addForm.style.display = 'none';
        }
    }
    
    // Bulk actions (edit/delete operations)
    const bulkActions = document.querySelectorAll('.bulk-btn');
    bulkActions.forEach(btn => {
        const isEditAction = btn.onclick?.toString().includes('markPurchased') || 
                           btn.onclick?.toString().includes('markNeeded') ||
                           btn.onclick?.toString().includes('deleteSelected');
        
        if (isEditAction && !canEditItems()) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.title = 'You need write permission to perform this action';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.title = '';
        }
    });
    
    // Share dropdown
    const shareDropdown = document.querySelector('.share-dropdown');
    if (shareDropdown) {
        if (canShareList()) {
            shareDropdown.style.display = 'inline-block';
        } else {
            shareDropdown.style.display = 'none';
        }
    }
    
    // List management buttons
    const renameBtn = document.getElementById('renameListBtn');
    const deleteBtn = document.getElementById('deleteListBtn');
    const defaultBtn = document.getElementById('defaultListBtn');
    
    if (renameBtn && deleteBtn) {
        const canManage = canManageList();
        renameBtn.disabled = !canManage;
        deleteBtn.disabled = !canManage;
        defaultBtn.disabled = !canManage; // Only owners can set default
        
        if (!canManage) {
            renameBtn.style.opacity = '0.5';
            deleteBtn.style.opacity = '0.5';
            defaultBtn.style.opacity = '0.5';
            renameBtn.title = 'Only the list owner can rename lists';
            deleteBtn.title = 'Only the list owner can delete lists';
            defaultBtn.title = 'Only the list owner can set default lists';
        } else {
            renameBtn.style.opacity = '1';
            deleteBtn.style.opacity = '1';
            defaultBtn.style.opacity = '1';
            renameBtn.title = 'Rename list';
            deleteBtn.title = 'Delete list';
            defaultBtn.title = 'Set as default';
        }
    }
}

// Sharing management functions
function showSharingModal() {
    if (!currentListId) {
        alert('No shopping list selected');
        return;
    }
    
    // Check permissions
    if (!canShareList()) {
        alert('You do not have permission to manage sharing for this list');
        return;
    }
    
    // Pause polling while modal is open
    pausePolling();
    
    // Create modal HTML for sharing management
    const modalHtml = `
        <div class="auth-overlay" id="sharingModalOverlay" style="display: flex;">
            <div class="auth-modal sharing-modal">
                <div class="auth-header">
                    <h2 class="auth-title">Manage Sharing</h2>
                    <p class="auth-subtitle">Control who has access to this shopping list</p>
                </div>
                
                <div class="sharing-tabs">
                    <button class="sharing-tab active" data-tab="users">Shared Users</button>
                    <button class="sharing-tab" data-tab="invite">Invite User</button>
                </div>
                
                <div class="auth-error" id="sharingError" style="display: none;"></div>
                <div class="auth-success" id="sharingSuccess" style="display: none;"></div>
                
                <!-- Shared Users Tab -->
                <div class="sharing-tab-content" id="usersTab">
                    <div class="shared-users-list" id="sharedUsersList">
                        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                            Loading...
                        </div>
                    </div>
                </div>
                
                <!-- Invite User Tab -->
                <div class="sharing-tab-content" id="inviteTab" style="display: none;">
                    <form id="sharingInviteForm">
                        <div class="form-group">
                            <label class="form-label" for="sharingInviteUsername">Username:</label>
                            <input type="text" class="form-input" id="sharingInviteUsername" placeholder="Enter username..." required autocomplete="off">
                            <div id="sharingUserSearchResults" style="display: none; margin-top: 0.5rem;"></div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="sharingInvitePermission">Permission Level:</label>
                            <select class="form-input form-select" id="sharingInvitePermission" required>
                                <option value="read">Read Only (can view and check items)</option>
                                <option value="write">Read & Write (can add, edit, delete items)</option>
                            </select>
                        </div>
                        <button type="submit" class="auth-btn primary" style="width: 100%;">Send Invitation</button>
                    </form>
                </div>
                
                <div class="auth-actions" style="margin-top: 1.5rem;">
                    <button type="button" class="auth-btn secondary" onclick="hideSharingModal()">Close</button>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Set up tab switching
    document.querySelectorAll('.sharing-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            switchSharingTab(tabName);
        });
    });
    
    // Set up form submission
    document.getElementById('sharingInviteForm').addEventListener('submit', handleSharingInviteSubmit);
    
    // Set up username search
    document.getElementById('sharingInviteUsername').addEventListener('input', searchUsersForSharing);
    
    // Load shared users
    loadSharedUsers();
}

function switchSharingTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.sharing-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    // Update tab content
    document.querySelectorAll('.sharing-tab-content').forEach(content => {
        content.style.display = content.id === `${tabName}Tab` ? 'block' : 'none';
    });
}

function hideSharingModal() {
    const modal = document.getElementById('sharingModalOverlay');
    if (modal) {
        modal.remove();
    }
    
    // Resume polling when modal closes
    setTimeout(() => {
        resumePolling();
    }, 500);
}

async function loadSharedUsers() {
    try {
        const response = await apiRequest(`/lists/${currentListId}/shares`);
        const shares = response.shares || [];
        
        const sharedUsersList = document.getElementById('sharedUsersList');
        
        if (shares.length === 0) {
            sharedUsersList.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.5; margin-bottom: 1rem;">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <p>This list isn't shared with anyone yet</p>
                    <p style="font-size: 0.875rem; margin-top: 0.5rem;">Use the "Invite User" tab to share it</p>
                </div>
            `;
            return;
        }
        
        sharedUsersList.innerHTML = shares.map(share => `
            <div class="shared-user-item" data-share-id="${share.id}">
                <div class="shared-user-info">
                    <div class="shared-user-name">${share.username}</div>
                    <div class="shared-user-meta">
                        <span class="shared-user-permission ${share.permission}">${share.permission}</span>
                        <span class="shared-user-status ${share.status}">${share.status}</span>
                        <span class="shared-user-date">${formatSharingDate(share.shared_at)}</span>
                    </div>
                </div>
                <div class="shared-user-actions">
                    <select class="permission-select" data-share-id="${share.id}" data-current="${share.permission}">
                        <option value="read" ${share.permission === 'read' ? 'selected' : ''}>Read</option>
                        <option value="write" ${share.permission === 'write' ? 'selected' : ''}>Write</option>
                    </select>
                    <button class="remove-user-btn" onclick="removeUserFromSharing(${share.id})" title="Remove user">×</button>
                </div>
            </div>
        `).join('');
        
        // Add event listeners for permission changes
        document.querySelectorAll('.permission-select').forEach(select => {
            select.addEventListener('change', handlePermissionChange);
        });
        
    } catch (error) {
        console.error('Failed to load shared users:', error);
        document.getElementById('sharedUsersList').innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--danger);">
                Failed to load shared users. Please try again.
            </div>
        `;
    }
}

function formatSharingDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
}

async function handlePermissionChange(event) {
    const shareId = parseInt(event.target.dataset.shareId);
    const newPermission = event.target.value;
    const currentPermission = event.target.dataset.current;
    
    if (newPermission === currentPermission) return;
    
    try {
        await apiRequest(`/lists/${currentListId}/shares/${shareId}`, {
            method: 'PUT',
            body: JSON.stringify({ permission: newPermission })
        });
        
        event.target.dataset.current = newPermission;
        showSharingSuccess(`Permission updated to ${newPermission}`);
        
    } catch (error) {
        console.error('Failed to update permission:', error);
        // Revert the select value
        event.target.value = currentPermission;
        showSharingError(`Failed to update permission: ${error.message}`);
    }
}

async function removeUserFromSharing(shareId) {
    if (!confirm('Are you sure you want to remove this user from the list?')) {
        return;
    }
    
    try {
        await apiRequest(`/lists/${currentListId}/shares/${shareId}`, {
            method: 'DELETE'
        });
        
        // Remove from UI
        const userItem = document.querySelector(`[data-share-id="${shareId}"]`);
        if (userItem) {
            userItem.remove();
        }
        
        // Check if list is now empty
        const remainingUsers = document.querySelectorAll('.shared-user-item');
        if (remainingUsers.length === 0) {
            loadSharedUsers(); // Reload to show empty state
        }
        
        showSharingSuccess('User removed from list');
        
    } catch (error) {
        console.error('Failed to remove user:', error);
        showSharingError(`Failed to remove user: ${error.message}`);
    }
}

function showSharingError(message) {
    const errorEl = document.getElementById('sharingError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => errorEl.style.display = 'none', 5000);
    }
}

function showSharingSuccess(message) {
    const successEl = document.getElementById('sharingSuccess');
    if (successEl) {
        successEl.textContent = message;
        successEl.style.display = 'block';
        setTimeout(() => successEl.style.display = 'none', 3000);
    }
}

async function searchUsersForSharing(event) {
    const query = event.target.value.trim();
    const resultsDiv = document.getElementById('sharingUserSearchResults');
    
    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await apiRequest(`/users/search?q=${encodeURIComponent(query)}`);
        const users = response.users;
        
        if (users.length === 0) {
            resultsDiv.innerHTML = '<div style="padding: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">No users found</div>';
            resultsDiv.style.display = 'block';
            return;
        }
        
        resultsDiv.innerHTML = users.map(user => `
            <div class="user-search-result" onclick="selectUserForSharing('${user.username}')" 
                 style="padding: 0.5rem; cursor: pointer; border-bottom: 1px solid var(--border-light); font-size: 0.875rem;">
                <strong>${user.username}</strong>
                <div style="color: var(--text-secondary); font-size: 0.75rem;">${user.email}</div>
            </div>
        `).join('');
        
        resultsDiv.style.display = 'block';
        
    } catch (error) {
        console.error('Failed to search users:', error);
    }
}

function selectUserForSharing(username) {
    document.getElementById('sharingInviteUsername').value = username;
    document.getElementById('sharingUserSearchResults').style.display = 'none';
}

async function handleSharingInviteSubmit(event) {
    event.preventDefault();
    
    const username = document.getElementById('sharingInviteUsername').value.trim();
    const permission = document.getElementById('sharingInvitePermission').value;
    
    if (!username) {
        showSharingError('Please enter a username');
        return;
    }
    
    try {
        const response = await apiRequest(`/lists/${currentListId}/invite`, {
            method: 'POST',
            body: JSON.stringify({
                username: username,
                permission: permission
            })
        });
        
        showSharingSuccess(`Invitation sent to ${username}`);
        
        // Clear form
        document.getElementById('sharingInviteForm').reset();
        document.getElementById('sharingUserSearchResults').style.display = 'none';
        
        // Switch back to users tab and reload
        switchSharingTab('users');
        setTimeout(() => loadSharedUsers(), 1000);
        
    } catch (error) {
        console.error('Failed to send invitation:', error);
        showSharingError(`Failed to send invitation: ${error.message}`);
    }
}

// User invitation functions
function showInviteModal() {
    // Hide the share dropdown first
    document.getElementById('shareDropdown').style.display = 'none';
    
    // Check permissions
    if (!canShareList()) {
        alert('You do not have permission to share this list');
        return;
    }
    
    if (!currentListId) {
        alert('No shopping list selected to share');
        return;
    }

    // Pause polling while modal is open
    pausePolling();

    // Create modal HTML for user invitation
    const modalHtml = `
        <div class="auth-overlay" id="inviteModalOverlay" style="display: flex;">
            <div class="auth-modal">
                <div class="auth-header">
                    <h2 class="auth-title">Invite User to List</h2>
                    <p class="auth-subtitle">Enter a username to invite them to collaborate</p>
                </div>
                <div class="auth-error" id="inviteError" style="display: none;"></div>
                <div class="auth-success" id="inviteSuccess" style="display: none;"></div>
                <form id="inviteForm">
                    <div class="form-group">
                        <label class="form-label" for="inviteUsername">Username:</label>
                        <input type="text" class="form-input" id="inviteUsername" placeholder="Enter username..." required autocomplete="off">
                        <div id="userSearchResults" style="display: none; margin-top: 0.5rem;"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="invitePermission">Permission Level:</label>
                        <select class="form-input form-select" id="invitePermission" required>
                            <option value="read">Read Only (can view and check items)</option>
                            <option value="write">Read & Write (can add, edit, delete items)</option>
                        </select>
                    </div>
                    <div class="auth-actions">
                        <button type="button" class="auth-btn secondary" onclick="hideInviteModal()">Cancel</button>
                        <button type="submit" class="auth-btn primary">Send Invitation</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Set up form submission
    document.getElementById('inviteForm').addEventListener('submit', handleInviteSubmit);
    
    // Set up username search
    document.getElementById('inviteUsername').addEventListener('input', searchUsers);
}

function hideInviteModal() {
    const modal = document.getElementById('inviteModalOverlay');
    if (modal) {
        modal.remove();
    }
    
    // Resume polling when modal closes
    setTimeout(() => {
        resumePolling();
    }, 500);
}

async function searchUsers(event) {
    const query = event.target.value.trim();
    const resultsDiv = document.getElementById('userSearchResults');
    
    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await apiRequest(`/users/search?q=${encodeURIComponent(query)}`);
        const users = response.users;
        
        if (users.length === 0) {
            resultsDiv.innerHTML = '<div style="padding: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">No users found</div>';
            resultsDiv.style.display = 'block';
            return;
        }
        
        resultsDiv.innerHTML = users.map(user => `
            <div class="user-search-result" onclick="selectUser('${user.username}')" 
                 style="padding: 0.5rem; cursor: pointer; border-bottom: 1px solid var(--border-light); font-size: 0.875rem;">
                <strong>${user.username}</strong>
                <div style="color: var(--text-secondary); font-size: 0.75rem;">${user.email}</div>
            </div>
        `).join('');
        
        resultsDiv.style.display = 'block';
        
    } catch (error) {
        console.error('Failed to search users:', error);
    }
}

function selectUser(username) {
    document.getElementById('inviteUsername').value = username;
    document.getElementById('userSearchResults').style.display = 'none';
}

async function handleInviteSubmit(event) {
    event.preventDefault();
    
    const username = document.getElementById('inviteUsername').value.trim();
    const permission = document.getElementById('invitePermission').value;
    const errorEl = document.getElementById('inviteError');
    const successEl = document.getElementById('inviteSuccess');
    
    // Clear previous messages
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    
    if (!username) {
        errorEl.textContent = 'Please enter a username';
        errorEl.style.display = 'block';
        return;
    }
    
    try {
        const response = await apiRequest(`/lists/${currentListId}/invite`, {
            method: 'POST',
            body: JSON.stringify({
                username: username,
                permission: permission
            })
        });
        
        successEl.textContent = `Invitation sent to ${username}`;
        successEl.style.display = 'block';
        
        // Clear form
        document.getElementById('inviteForm').reset();
        document.getElementById('userSearchResults').style.display = 'none';
        
        // Auto-close after success
        setTimeout(() => {
            hideInviteModal();
        }, 2000);
        
    } catch (error) {
        console.error('Failed to send invitation:', error);
        errorEl.textContent = `Failed to send invitation: ${error.message}`;
        errorEl.style.display = 'block';
    }
}

// Header notification bell functions
window.toggleNotifications = function() {
    console.log('toggleNotifications called');
    const dropdown = document.getElementById('notificationDropdown');
    const isVisible = dropdown.style.display === 'block';
    
    // Close all other dropdowns
    document.querySelectorAll('.share-menu, .notification-dropdown').forEach(menu => {
        if (menu !== dropdown) {
            menu.style.display = 'none';
        }
    });
    
    dropdown.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
        // Load latest notifications when opening
        loadNotifications();
    }
}

// Close notification dropdown when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.notification-bell-container')) {
        document.getElementById('notificationDropdown').style.display = 'none';
    }
});

// Notifications functions
async function loadNotifications() {
    try {
        const response = await apiRequest('/notifications');
        const notifications = response.notifications;
        
        renderNotifications(notifications);
        updateNotificationCount(notifications);
        
    } catch (error) {
        console.error('Failed to load notifications:', error);
    }
}

function renderNotifications(notifications) {
    const list = document.getElementById('headerNotificationsList');
    const noNotifications = document.getElementById('noNotifications');
    
    // Filter to show only unread notifications
    const unreadNotifications = notifications.filter(n => !n.is_read);
    
    if (unreadNotifications.length === 0) {
        list.innerHTML = '';
        noNotifications.style.display = 'flex';
        return;
    }
    
    noNotifications.style.display = 'none';
    
    list.innerHTML = unreadNotifications.map(notification => {
        const isInvitation = notification.type === 'share_invitation';
        const data = notification.data || {};
        
        return `
            <div class="notification-item ${notification.is_read ? '' : 'unread'}" data-notification-id="${notification.id}">
                <div class="notification-header-content">
                    <div class="notification-title">${notification.title}</div>
                    <button class="close-notification-btn" data-notification-id="${notification.id}" title="Dismiss notification">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="notification-message">${notification.message}</div>
                ${isInvitation && !notification.is_read ? `
                    <div class="notification-actions">
                        <button class="notification-btn accept" onclick="respondToInvitation(${notification.id}, 'accepted')">
                            Accept
                        </button>
                        <button class="notification-btn decline" onclick="respondToInvitation(${notification.id}, 'declined')">
                            Decline
                        </button>
                    </div>
                ` : ''}
                <div class="notification-time">${formatNotificationTime(notification.created_at)}</div>
            </div>
        `;
    }).join('');
    
    // Add event listeners for dismiss buttons (using event delegation)
    setTimeout(() => {
        document.querySelectorAll('.close-notification-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const notificationId = parseInt(btn.getAttribute('data-notification-id'));
                window.dismissNotification(notificationId);
            });
        });
    }, 0);
}

function updateNotificationCount(notifications) {
    const unreadCount = notifications.filter(n => !n.is_read).length;
    const badge = document.getElementById('notificationBadge');
    const bell = document.querySelector('.notification-bell');
    
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
        badge.style.display = 'flex';
        bell.classList.add('has-notifications');
    } else {
        badge.style.display = 'none';
        bell.classList.remove('has-notifications');
    }
}

function formatNotificationTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
}

async function respondToInvitation(notificationId, response) {
    try {
        // Convert 'accepted'/'declined' to 'accept'/'decline' for backend
        const action = response === 'accepted' ? 'accept' : 'decline';
        
        await apiRequest(`/notifications/${notificationId}/respond`, {
            method: 'POST',
            body: JSON.stringify({ action })
        });
        
        // Reload notifications and lists
        await loadNotifications();
        await loadUserShoppingLists();
        populateListSelector();
        
        // Close notification dropdown
        document.getElementById('notificationDropdown').style.display = 'none';
        
        // Show success message
        if (response === 'accepted') {
            // Show subtle success indicator instead of alert
            showUpdateIndicator('notifications');
            
            // Optionally switch to the newly shared list
            // Note: We don't have the list ID from the response, but the user can manually switch
        } else {
            // Show subtle decline indicator
            showUpdateIndicator('notifications');
        }
        
    } catch (error) {
        console.error('Failed to respond to invitation:', error);
        alert(`Failed to ${response} invitation: ${error.message}`);
    }
}

// Make sure functions are globally available
window.dismissNotification = async function(notificationId) {
    console.log('dismissNotification called with ID:', notificationId);
    console.log('Current authToken:', authToken ? 'present' : 'missing');
    try {
        // Find and animate the notification item
        const notificationItem = document.querySelector(`[data-notification-id="${notificationId}"]`);
        if (notificationItem) {
            notificationItem.style.opacity = '0.5';
            notificationItem.style.transform = 'scale(0.95)';
        }
        
        // Mark notification as read (dismiss it)
        console.log('Making API request to mark notification as read:', `/notifications/${notificationId}/read`);
        const response = await apiRequest(`/notifications/${notificationId}/read`, {
            method: 'PUT'
        });
        console.log('API response:', response);
        
        // Reload notifications to update UI
        console.log('Reloading notifications...');
        await loadNotifications();
        console.log('Notifications reloaded');
        
    } catch (error) {
        console.error('Failed to dismiss notification:', error);
        
        // Revert animation on error
        const notificationItem = document.querySelector(`[data-notification-id="${notificationId}"]`);
        if (notificationItem) {
            notificationItem.style.opacity = '';
            notificationItem.style.transform = '';
        }
        
        alert(`Failed to dismiss notification: ${error.message}`);
    }
}

window.markAllNotificationsRead = async function() {
    console.log('markAllNotificationsRead called');
    try {
        const response = await apiRequest('/notifications');
        const notifications = response.notifications;
        
        // Mark all unread notifications as read
        const unreadNotifications = notifications.filter(n => !n.is_read);
        
        if (unreadNotifications.length === 0) {
            // No unread notifications - just close dropdown
            document.getElementById('notificationDropdown').style.display = 'none';
            return;
        }
        
        // Animate all unread notifications
        unreadNotifications.forEach(notification => {
            const notificationItem = document.querySelector(`[data-notification-id="${notification.id}"]`);
            if (notificationItem) {
                notificationItem.style.opacity = '0.6';
                notificationItem.style.transition = 'opacity 0.3s ease';
            }
        });
        
        // Use Promise.all to mark all in parallel for better performance
        await Promise.all(
            unreadNotifications.map(notification =>
                apiRequest(`/notifications/${notification.id}/read`, {
                    method: 'PUT'
                })
            )
        );
        
        // Reload notifications
        await loadNotifications();
        
        // Close dropdown after marking all as read
        setTimeout(() => {
            document.getElementById('notificationDropdown').style.display = 'none';
        }, 1000);
        
    } catch (error) {
        console.error('Failed to mark notifications as read:', error);
        alert('Failed to mark all notifications as read. Please try again.');
    }
}

// Auto-update system
function startAutoUpdate() {
    console.log('Starting auto-update polling...');
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
    }
    
    updateConnectionStatus('online');
    
    pollingIntervalId = setInterval(async () => {
        if (!authToken || !currentUser) {
            console.log('No auth token or user, skipping polling');
            return;
        }
        
        if (pollingPaused) {
            console.log('Polling paused, skipping update check');
            return;
        }
        
        try {
            // Check for notification updates
            await checkNotificationUpdates();
            
            // Check for list updates if we have a current list
            if (currentListId) {
                await checkListUpdates();
            }
        } catch (error) {
            console.error('Polling error:', error);
            
            // Show offline status on network errors
            if (error.message.includes('Failed to fetch') || error.message.includes('Network')) {
                updateConnectionStatus('offline');
                
                // Try to reconnect after a delay
                setTimeout(() => {
                    if (!pollingPaused) {
                        updateConnectionStatus('online');
                    }
                }, 10000); // 10 seconds
            }
            
            // Don't stop polling on errors, just log them
        }
    }, POLLING_INTERVAL);
}

function stopAutoUpdate() {
    console.log('Stopping auto-update polling...');
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
    updateConnectionStatus('offline');
}

function pausePolling() {
    console.log('Pausing auto-update polling...');
    pollingPaused = true;
    updateConnectionStatus('paused');
}

function resumePolling() {
    console.log('Resuming auto-update polling...');
    pollingPaused = false;
    updateConnectionStatus('online');
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.querySelector('.status-text');
    
    if (!indicator || !statusText) return;
    
    // Remove all status classes
    indicator.className = 'status-indicator';
    
    // Add current status class
    indicator.classList.add(status);
    
    // Update text
    const statusTexts = {
        'online': 'Online',
        'offline': 'Offline',
        'paused': 'Paused'
    };
    
    statusText.textContent = statusTexts[status] || 'Unknown';
    
    // Update tooltip
    const connectionStatus = document.getElementById('connectionStatus');
    if (connectionStatus) {
        const tooltips = {
            'online': 'Auto-update is active - checking for changes every 5 seconds',
            'offline': 'Auto-update is disabled',
            'paused': 'Auto-update is temporarily paused while you are editing'
        };
        connectionStatus.title = tooltips[status] || 'Auto-update status';
    }
}

async function checkNotificationUpdates() {
    try {
        const response = await apiRequest('/notifications');
        const notifications = response.notifications;
        
        // Check if we have new notifications or updates
        const latestNotificationTime = notifications.length > 0 ? 
            Math.max(...notifications.map(n => new Date(n.created_at).getTime())) : 0;
        
        if (lastNotificationUpdate === null) {
            // First time - just store the timestamp
            lastNotificationUpdate = latestNotificationTime;
            return;
        }
        
        if (latestNotificationTime > lastNotificationUpdate) {
            console.log('New notifications detected, updating...');
            renderNotifications(notifications);
            updateNotificationCount(notifications);
            lastNotificationUpdate = latestNotificationTime;
            
            // Show subtle notification indicator
            showUpdateIndicator('notifications');
        }
    } catch (error) {
        console.error('Failed to check notification updates:', error);
    }
}

async function checkListUpdates() {
    try {
        const response = await apiRequest(`/lists/${currentListId}`);
        const list = response.list;
        
        const latestUpdateTime = new Date(list.updated_at).getTime();
        
        if (lastListUpdate === null) {
            // First time - just store the timestamp
            lastListUpdate = latestUpdateTime;
            console.log('Initial list timestamp:', new Date(latestUpdateTime).toISOString());
            return;
        }
        
        console.log('Comparing timestamps:');
        console.log('  Last known:', new Date(lastListUpdate).toISOString());
        console.log('  Server now:', new Date(latestUpdateTime).toISOString());
        console.log('  Difference:', latestUpdateTime - lastListUpdate, 'ms');
        
        if (latestUpdateTime > lastListUpdate) {
            console.log('List updates detected, refreshing...');
            
            // Update local data
            Object.keys(categories).forEach(cat => {
                categories[cat].items = [];
            });
            
            if (list.items && list.items.length > 0) {
                list.items.forEach(item => {
                    if (categories[item.category]) {
                        categories[item.category].items.push({
                            id: item.id,
                            name: item.name,
                            quantity: item.quantity,
                            priority: item.priority,
                            notes: item.notes || '',
                            completed: item.completed
                        });
                    }
                });
            }
            
            renderCategories();
            updateStats();
            lastListUpdate = latestUpdateTime;
        } else {
            console.log('No updates detected');
        }
    } catch (error) {
        console.error('Failed to check list updates:', error);
    }
}

function showUpdateIndicator(type) {
    // Create a subtle flash indicator
    const indicator = document.createElement('div');
    indicator.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(34, 197, 94, 0.9);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 0.875rem;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    const messages = {
        'notifications': 'Notifications updated',
        'list': 'Shopping list updated'
    };
    
    indicator.textContent = messages[type] || 'Updates received';
    document.body.appendChild(indicator);
    
    // Add CSS animation if not already added
    if (!document.getElementById('updateIndicatorStyles')) {
        const style = document.createElement('style');
        style.id = 'updateIndicatorStyles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (indicator.parentNode) {
            indicator.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
            }, 300);
        }
    }, 3000);
}

// Bulk actions implementation
function bulkSelect() {
    isSelectionMode = !isSelectionMode;
    
    if (!isSelectionMode) {
        // Exiting selection mode, clear selections
        selectedItems.clear();
    }
    
    updateBulkActionButtons();
    renderCategories();
}

function toggleItemSelection(categoryId, itemId) {
    const itemKey = `${categoryId}-${itemId}`;
    
    if (selectedItems.has(itemKey)) {
        selectedItems.delete(itemKey);
    } else {
        selectedItems.add(itemKey);
    }
    
    updateBulkActionButtons();
    renderCategories();
}

async function markPurchased() {
    if (selectedItems.size === 0) {
        showToast('No items selected', 'warning');
        return;
    }
    
    if (!canEditItems()) {
        showToast('You do not have permission to edit items in this list', 'error');
        return;
    }
    
    const itemsToUpdate = Array.from(selectedItems);
    let successCount = 0;
    let errorCount = 0;
    
    for (const itemKey of itemsToUpdate) {
        try {
            const [categoryId, itemId] = itemKey.split('-');
            const category = categories[categoryId];
            const item = category.items.find(item => item.id === parseInt(itemId));
            
            if (item && !item.completed) {
                await apiRequest(`/lists/${currentListId}/items/${itemId}/toggle`, {
                    method: 'PUT'
                });
                
                item.completed = true;
                successCount++;
            }
        } catch (error) {
            console.error(`Failed to mark item as purchased:`, error);
            errorCount++;
        }
    }
    
    // Clear selections and exit selection mode
    selectedItems.clear();
    isSelectionMode = false;
    updateBulkActionButtons();
    renderCategories();
    updateStats();
    
    if (successCount === 0 && errorCount === 0) {
        showToast('No items needed to be marked as purchased', 'info');
    } else if (errorCount > 0) {
        showToast(`Marked ${successCount} items as purchased. ${errorCount} items failed to update.`, 'warning');
    } else {
        showToast(`Successfully marked ${successCount} items as purchased.`, 'success');
    }
}

async function markNeeded() {
    if (selectedItems.size === 0) {
        showToast('No items selected', 'warning');
        return;
    }
    
    if (!canEditItems()) {
        showToast('You do not have permission to edit items in this list', 'error');
        return;
    }
    
    const itemsToUpdate = Array.from(selectedItems);
    let successCount = 0;
    let errorCount = 0;
    
    for (const itemKey of itemsToUpdate) {
        try {
            const [categoryId, itemId] = itemKey.split('-');
            const category = categories[categoryId];
            const item = category.items.find(item => item.id === parseInt(itemId));
            
            if (item && item.completed) {
                await apiRequest(`/lists/${currentListId}/items/${itemId}/toggle`, {
                    method: 'PUT'
                });
                
                item.completed = false;
                successCount++;
            }
        } catch (error) {
            console.error(`Failed to mark item as needed:`, error);
            errorCount++;
        }
    }
    
    // Clear selections and exit selection mode
    selectedItems.clear();
    isSelectionMode = false;
    updateBulkActionButtons();
    renderCategories();
    updateStats();
    
    if (successCount === 0 && errorCount === 0) {
        showToast('No items needed to be marked as needed', 'info');
    } else if (errorCount > 0) {
        showToast(`Marked ${successCount} items as needed. ${errorCount} items failed to update.`, 'warning');
    } else {
        showToast(`Successfully marked ${successCount} items as needed.`, 'success');
    }
}

async function deleteSelected() {
    if (selectedItems.size === 0) {
        showToast('No items selected', 'warning');
        return;
    }
    
    if (!canDeleteItems()) {
        showToast('You do not have permission to delete items in this list', 'error');
        return;
    }
    
    const confirmMessage = `Are you sure you want to delete ${selectedItems.size} selected item(s)? This action cannot be undone.`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    const itemsToDelete = Array.from(selectedItems);
    let successCount = 0;
    let errorCount = 0;
    
    for (const itemKey of itemsToDelete) {
        try {
            const [categoryId, itemId] = itemKey.split('-');
            
            await apiRequest(`/lists/${currentListId}/items/${itemId}`, {
                method: 'DELETE'
            });
            
            // Remove from local data
            const category = categories[categoryId];
            const itemIndex = category.items.findIndex(item => item.id === parseInt(itemId));
            if (itemIndex !== -1) {
                category.items.splice(itemIndex, 1);
            }
            
            successCount++;
        } catch (error) {
            console.error(`Failed to delete item:`, error);
            errorCount++;
        }
    }
    
    // Clear selections and exit selection mode
    selectedItems.clear();
    isSelectionMode = false;
    updateBulkActionButtons();
    renderCategories();
    updateStats();
    
    if (errorCount > 0) {
        showToast(`Deleted ${successCount} items. ${errorCount} items failed to delete.`, 'warning');
    } else {
        showToast(`Successfully deleted ${successCount} items.`, 'success');
    }
}

function updateBulkActionButtons() {
    const bulkActions = document.querySelector('.bulk-actions');
    const selectBtn = bulkActions.querySelector('button[onclick="bulkSelect()"]');
    const markPurchasedBtn = bulkActions.querySelector('button[onclick="markPurchased()"]');
    const markNeededBtn = bulkActions.querySelector('button[onclick="markNeeded()"]');
    const deleteBtn = bulkActions.querySelector('button[onclick="deleteSelected()"]');
    
    // Update select button
    if (isSelectionMode) {
        selectBtn.textContent = `Cancel (${selectedItems.size} selected)`;
        selectBtn.classList.add('active');
    } else {
        selectBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            Select
        `;
        selectBtn.classList.remove('active');
    }
    
    // Enable/disable action buttons based on selection
    const hasSelection = selectedItems.size > 0;
    const canEdit = canEditItems();
    const canDelete = canDeleteItems();
    
    markPurchasedBtn.disabled = !isSelectionMode || !hasSelection || !canEdit;
    markNeededBtn.disabled = !isSelectionMode || !hasSelection || !canEdit;
    deleteBtn.disabled = !isSelectionMode || !hasSelection || !canDelete;
    
    // Update button opacity based on state
    markPurchasedBtn.style.opacity = markPurchasedBtn.disabled ? '0.5' : '1';
    markNeededBtn.style.opacity = markNeededBtn.disabled ? '0.5' : '1';
    deleteBtn.style.opacity = deleteBtn.disabled ? '0.5' : '1';
}

// Toast notification system
function showToast(message, type = 'info', duration = 5000) {
    const toastContainer = document.getElementById('toastContainer');
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto-remove after duration
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize bulk action buttons
    updateBulkActionButtons();
    
    // Search input
    document.getElementById('searchInput').addEventListener('input', renderCategories);

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderCategories();
        });
    });

    // Autocomplete event listeners
    const itemNameInput = document.getElementById('itemName');
    
    itemNameInput.addEventListener('input', (e) => {
        const query = e.target.value;
        const suggestions = getAutocompleteItems(query);
        showAutocompleteSuggestions(suggestions);
    });

    // Pause polling while user is actively typing
    itemNameInput.addEventListener('focus', () => {
        pausePolling();
    });
    
    itemNameInput.addEventListener('blur', () => {
        // Resume polling after a short delay
        setTimeout(() => {
            resumePolling();
        }, 1000);
    });

    itemNameInput.addEventListener('keydown', (e) => {
        const suggestionsContainer = document.getElementById('autocompleteSuggestions');
        const suggestions = suggestionsContainer.querySelectorAll('.autocomplete-suggestion');
        
        if (suggestions.length === 0) return;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestions.length - 1);
                updateSuggestionHighlight(suggestions);
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                updateSuggestionHighlight(suggestions);
                break;
                
            case 'Enter':
                if (selectedSuggestionIndex >= 0) {
                    e.preventDefault();
                    selectSuggestion(selectedSuggestionIndex);
                }
                break;
                
            case 'Escape':
                hideSuggestions();
                break;
        }
    });

    function updateSuggestionHighlight(suggestions) {
        suggestions.forEach((suggestion, index) => {
            suggestion.classList.toggle('highlighted', index === selectedSuggestionIndex);
        });
    }

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete-container')) {
            hideSuggestions();
        }
    });

    // Authentication form event listeners
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        const submitBtn = document.getElementById('loginSubmit');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading-state');
        submitBtn.textContent = 'Signing in...';
        
        await login(email, password);
        
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading-state');
        submitBtn.textContent = 'Sign In';
    });

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        
        const submitBtn = document.getElementById('registerSubmit');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading-state');
        submitBtn.textContent = 'Creating account...';
        
        await register(username, email, password);
        
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading-state');
        submitBtn.textContent = 'Create Account';
    });

    // Shopping List Dropdown event listeners
    const shoppingListToggle = document.getElementById('shoppingListToggle');
    if (shoppingListToggle) {
        shoppingListToggle.addEventListener('click', toggleShoppingListDropdown);
    }
    
    // Notification bell event listeners
    const notificationBell = document.getElementById('notificationBell');
    const clearAllBtn = document.getElementById('clearAllBtn');
    
    if (notificationBell) {
        notificationBell.addEventListener('click', window.toggleNotifications);
    }
    
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', window.markAllNotificationsRead);
    }
    
    // Click outside to close dropdowns
    document.addEventListener('click', (e) => {
        // Close shopping list dropdown
        const shoppingListContainer = document.querySelector('.shopping-list-dropdown-container');
        if (shoppingListContainer && !shoppingListContainer.contains(e.target)) {
            const dropdown = document.getElementById('shoppingListDropdown');
            if (dropdown && dropdown.style.display !== 'none') {
                dropdown.style.display = 'none';
            }
        }
        
        // Close notification dropdown
        const notificationContainer = document.querySelector('.notification-bell-container');
        if (notificationContainer && !notificationContainer.contains(e.target)) {
            const notificationDropdown = document.getElementById('notificationDropdown');
            if (notificationDropdown && notificationDropdown.style.display !== 'none') {
                notificationDropdown.style.display = 'none';
            }
        }
    });

    // Initialize
    loadTheme();
    initializeApp();
});