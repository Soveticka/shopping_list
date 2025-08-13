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
let authToken = localStorage.getItem('authToken');
let selectedSuggestionIndex = -1;
let currentListId = null;
let userShoppingLists = [];
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

async function loadShoppingList() {
    try {
        console.log('Loading shopping lists...');
        const listsResponse = await apiRequest('/lists');
        userShoppingLists = listsResponse.lists;
        
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
    const selector = document.getElementById('listSelector');
    const renameBtn = document.getElementById('renameListBtn');
    const deleteBtn = document.getElementById('deleteListBtn');
    const defaultBtn = document.getElementById('defaultListBtn');
    
    // Check if elements exist
    if (!selector || !renameBtn || !deleteBtn || !defaultBtn) {
        console.warn('List selector elements not found');
        return;
    }
    
    // Clear existing options
    selector.innerHTML = '<option value="">Select a shopping list...</option>';
    
    // Add user's lists
    if (userShoppingLists && userShoppingLists.length > 0) {
        userShoppingLists.forEach(list => {
            const option = document.createElement('option');
            option.value = list.id;
            option.textContent = list.name;
            if (list.id === currentListId) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
    }
    
    // Enable/disable action buttons
    const hasSelection = currentListId && userShoppingLists && userShoppingLists.length > 0;
    renameBtn.disabled = !hasSelection;
    deleteBtn.disabled = !hasSelection || userShoppingLists.length <= 1;
    defaultBtn.disabled = !hasSelection;
    
    // Update default button appearance
    const currentList = userShoppingLists && userShoppingLists.find(list => list.id === currentListId);
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
    
    console.log('List selector updated:', { 
        hasSelection, 
        currentListId, 
        currentList,
        isCurrentDefault,
        listsCount: userShoppingLists ? userShoppingLists.length : 0,
        renameDisabled: renameBtn.disabled,
        deleteDisabled: deleteBtn.disabled,
        defaultDisabled: defaultBtn.disabled,
        hasCurrentListId: !!currentListId,
        hasUserShoppingLists: !!userShoppingLists,
        userShoppingListsLength: userShoppingLists ? userShoppingLists.length : 'null/undefined'
    });
}

async function switchShoppingList() {
    const selector = document.getElementById('listSelector');
    const newListId = parseInt(selector.value);
    
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
            populateListSelector(); // Update button states
            
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
        
        // Refresh memory
        await loadGroceryMemory();
        
        console.log('Item added successfully');
        
    } catch (error) {
        console.error('Failed to add item:', error);
        alert('Failed to add item: ' + error.message);
    }
}

function toggleItem(categoryId, itemId) {
    const category = categories[categoryId];
    const item = category.items.find(item => item.id === itemId);
    if (item) {
        item.completed = !item.completed;
        renderCategories();
        updateStats();
    }
}

function updateQuantity(categoryId, itemId, delta) {
    const category = categories[categoryId];
    const item = category.items.find(item => item.id === itemId);
    if (item) {
        item.quantity = Math.max(1, item.quantity + delta);
        renderCategories();
    }
}

function deleteItem(categoryId, itemId) {
    const category = categories[categoryId];
    category.items = category.items.filter(item => item.id !== itemId);
    renderCategories();
    updateStats();
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
                ${filteredItems.map(item => `
                    <div class="item ${item.completed ? 'completed' : ''}">
                        <input type="checkbox" class="item-checkbox" ${item.completed ? 'checked' : ''} 
                               onchange="toggleItem('${categoryId}', ${item.id})">
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
                                <button class="qty-btn" onclick="updateQuantity('${categoryId}', ${item.id}, -1)">−</button>
                                <span class="quantity-value">${item.quantity}</span>
                                <button class="qty-btn" onclick="updateQuantity('${categoryId}', ${item.id}, 1)">+</button>
                            </div>
                            <span>pcs</span>
                        </div>
                        <div class="item-actions">
                            <button class="action-btn delete" onclick="deleteItem('${categoryId}', ${item.id})">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3,6 5,6 21,6"></polyline>
                                    <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
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

// Bulk actions (placeholder functions)
function bulkSelect() { console.log('Bulk select'); }
function markPurchased() { console.log('Mark purchased'); }
function markNeeded() { console.log('Mark needed'); }
function deleteSelected() { console.log('Delete selected'); }

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
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

    // Initialize
    loadTheme();
    initializeApp();
});