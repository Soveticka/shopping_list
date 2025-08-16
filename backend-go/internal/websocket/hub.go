package websocket

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Message types for real-time updates
const (
	MessageTypeListUpdate    = "list_update"
	MessageTypeItemUpdate    = "item_update"
	MessageTypeShareUpdate   = "share_update"
	MessageTypeNotification  = "notification"
	MessageTypeUserOnline    = "user_online"
	MessageTypeUserOffline   = "user_offline"
)

// WebSocket message structure
type Message struct {
	Type    string      `json:"type"`
	UserID  int         `json:"user_id,omitempty"`
	ListID  int         `json:"list_id,omitempty"`
	Data    interface{} `json:"data"`
	Time    int64       `json:"time"`
}

// Client represents a connected WebSocket client
type Client struct {
	ID     string
	UserID int
	Hub    *Hub
	Conn   *websocket.Conn
	Send   chan Message
	Lists  map[int]bool // Lists this client is subscribed to
	mutex  sync.RWMutex
}

// Hub maintains the set of active clients and broadcasts messages
type Hub struct {
	// Registered clients by user ID
	Clients map[int]map[*Client]bool

	// Register requests from clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client

	// Broadcast channel for sending messages
	Broadcast chan Message

	// Mutex for thread-safe operations
	mutex sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	return &Hub{
		Clients:    make(map[int]map[*Client]bool),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan Message),
	}
}

// Run starts the hub's main loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.registerClient(client)

		case client := <-h.Unregister:
			h.unregisterClient(client)

		case message := <-h.Broadcast:
			h.broadcastMessage(message)
		}
	}
}

// registerClient adds a client to the hub
func (h *Hub) registerClient(client *Client) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	if h.Clients[client.UserID] == nil {
		h.Clients[client.UserID] = make(map[*Client]bool)
	}
	h.Clients[client.UserID][client] = true

	log.Printf("Client %s registered for user %d. Total clients for user: %d", 
		client.ID, client.UserID, len(h.Clients[client.UserID]))

	// Notify other users that this user is online
	h.broadcastUserStatus(client.UserID, MessageTypeUserOnline)
}

// unregisterClient removes a client from the hub
func (h *Hub) unregisterClient(client *Client) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	if clients, ok := h.Clients[client.UserID]; ok {
		if _, ok := clients[client]; ok {
			delete(clients, client)
			close(client.Send)

			// If no more clients for this user, remove the user
			if len(clients) == 0 {
				delete(h.Clients, client.UserID)
				h.broadcastUserStatus(client.UserID, MessageTypeUserOffline)
			}

			log.Printf("Client %s unregistered for user %d. Remaining clients for user: %d", 
				client.ID, client.UserID, len(clients))
		}
	}
}

// broadcastMessage sends a message to relevant clients
func (h *Hub) broadcastMessage(message Message) {
	h.mutex.RLock()
	defer h.mutex.RUnlock()

	switch message.Type {
	case MessageTypeListUpdate, MessageTypeItemUpdate:
		// Send to all users who have access to this list
		h.broadcastToListSubscribers(message)
	case MessageTypeShareUpdate:
		// Send to specific user and list owner
		h.broadcastToUser(message.UserID, message)
	case MessageTypeNotification:
		// Send to specific user
		h.broadcastToUser(message.UserID, message)
	case MessageTypeUserOnline, MessageTypeUserOffline:
		// Send to all connected users
		h.broadcastToAll(message)
	}
}

// broadcastToListSubscribers sends message to all clients subscribed to a list
func (h *Hub) broadcastToListSubscribers(message Message) {
	for userID, clients := range h.Clients {
		for client := range clients {
			client.mutex.RLock()
			isSubscribed := client.Lists[message.ListID]
			client.mutex.RUnlock()

			if isSubscribed {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(clients, client)
					if len(clients) == 0 {
						delete(h.Clients, userID)
					}
				}
			}
		}
	}
}

// broadcastToUser sends message to all clients of a specific user
func (h *Hub) broadcastToUser(userID int, message Message) {
	if clients, ok := h.Clients[userID]; ok {
		for client := range clients {
			select {
			case client.Send <- message:
			default:
				close(client.Send)
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.Clients, userID)
				}
			}
		}
	}
}

// broadcastToAll sends message to all connected clients
func (h *Hub) broadcastToAll(message Message) {
	for userID, clients := range h.Clients {
		for client := range clients {
			select {
			case client.Send <- message:
			default:
				close(client.Send)
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.Clients, userID)
				}
			}
		}
	}
}

// broadcastUserStatus notifies about user online/offline status
func (h *Hub) broadcastUserStatus(userID int, messageType string) {
	message := Message{
		Type:   messageType,
		UserID: userID,
		Data:   map[string]interface{}{"user_id": userID},
	}
	
	// Don't broadcast to self
	for otherUserID, clients := range h.Clients {
		if otherUserID != userID {
			for client := range clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(clients, client)
					if len(clients) == 0 {
						delete(h.Clients, otherUserID)
					}
				}
			}
		}
	}
}

// BroadcastListUpdate sends list update to subscribers
func (h *Hub) BroadcastListUpdate(listID int, data interface{}) {
	message := Message{
		Type:   MessageTypeListUpdate,
		ListID: listID,
		Data:   data,
	}
	h.Broadcast <- message
}

// BroadcastItemUpdate sends item update to list subscribers
func (h *Hub) BroadcastItemUpdate(listID int, data interface{}) {
	message := Message{
		Type:   MessageTypeItemUpdate,
		ListID: listID,
		Data:   data,
	}
	h.Broadcast <- message
}

// BroadcastShareUpdate sends share update to specific user
func (h *Hub) BroadcastShareUpdate(userID int, data interface{}) {
	message := Message{
		Type:   MessageTypeShareUpdate,
		UserID: userID,
		Data:   data,
	}
	h.Broadcast <- message
}

// BroadcastNotification sends notification to specific user
func (h *Hub) BroadcastNotification(userID int, data interface{}) {
	message := Message{
		Type:   MessageTypeNotification,
		UserID: userID,
		Data:   data,
	}
	h.Broadcast <- message
}

// GetOnlineUsers returns list of currently online user IDs
func (h *Hub) GetOnlineUsers() []int {
	h.mutex.RLock()
	defer h.mutex.RUnlock()

	var onlineUsers []int
	for userID := range h.Clients {
		onlineUsers = append(onlineUsers, userID)
	}
	return onlineUsers
}

// SubscribeToList subscribes a client to list updates
func (c *Client) SubscribeToList(listID int) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	if c.Lists == nil {
		c.Lists = make(map[int]bool)
	}
	c.Lists[listID] = true
}

// UnsubscribeFromList unsubscribes a client from list updates
func (c *Client) UnsubscribeFromList(listID int) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	if c.Lists != nil {
		delete(c.Lists, listID)
	}
}

// WebSocket upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// In production, implement proper origin checking
		return true
	},
}

// ServeWS handles WebSocket requests from clients
func (h *Hub) ServeWS(c *gin.Context, userID int) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		ID:     generateClientID(),
		UserID: userID,
		Hub:    h,
		Conn:   conn,
		Send:   make(chan Message, 256),
		Lists:  make(map[int]bool),
	}

	// Register client with hub
	h.Register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// generateClientID creates a unique client ID
func generateClientID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return "client_" + hex.EncodeToString(bytes)
}