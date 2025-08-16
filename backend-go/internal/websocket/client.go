package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 512
)

// ClientMessage represents incoming messages from clients
type ClientMessage struct {
	Type   string      `json:"type"`
	ListID int         `json:"list_id,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

// Client message types
const (
	ClientMessageSubscribe   = "subscribe"
	ClientMessageUnsubscribe = "unsubscribe"
	ClientMessagePing        = "ping"
)

// readPump pumps messages from the websocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, messageBytes, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		var clientMessage ClientMessage
		if err := json.Unmarshal(messageBytes, &clientMessage); err != nil {
			log.Printf("Failed to unmarshal client message: %v", err)
			continue
		}

		c.handleClientMessage(clientMessage)
	}
}

// writePump pumps messages from the hub to the websocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}

			// Add timestamp to message
			message.Time = time.Now().Unix()
			
			messageBytes, err := json.Marshal(message)
			if err != nil {
				log.Printf("Failed to marshal message: %v", err)
				w.Close()
				continue
			}

			w.Write(messageBytes)

			// Add queued messages to the current websocket message
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				queuedMessage := <-c.Send
				queuedMessage.Time = time.Now().Unix()
				
				queuedMessageBytes, err := json.Marshal(queuedMessage)
				if err != nil {
					log.Printf("Failed to marshal queued message: %v", err)
					continue
				}
				w.Write(queuedMessageBytes)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleClientMessage processes incoming messages from the client
func (c *Client) handleClientMessage(message ClientMessage) {
	switch message.Type {
	case ClientMessageSubscribe:
		if message.ListID > 0 {
			c.SubscribeToList(message.ListID)
			log.Printf("Client %s subscribed to list %d", c.ID, message.ListID)
			
			// Send confirmation
			response := Message{
				Type: "subscribed",
				ListID: message.ListID,
				Data: map[string]interface{}{
					"list_id": message.ListID,
					"status": "subscribed",
				},
			}
			
			select {
			case c.Send <- response:
			default:
				close(c.Send)
			}
		}

	case ClientMessageUnsubscribe:
		if message.ListID > 0 {
			c.UnsubscribeFromList(message.ListID)
			log.Printf("Client %s unsubscribed from list %d", c.ID, message.ListID)
			
			// Send confirmation
			response := Message{
				Type: "unsubscribed",
				ListID: message.ListID,
				Data: map[string]interface{}{
					"list_id": message.ListID,
					"status": "unsubscribed",
				},
			}
			
			select {
			case c.Send <- response:
			default:
				close(c.Send)
			}
		}

	case ClientMessagePing:
		// Send pong response
		response := Message{
			Type: "pong",
			Data: map[string]interface{}{
				"timestamp": time.Now().Unix(),
			},
		}
		
		select {
		case c.Send <- response:
		default:
			close(c.Send)
		}

	default:
		log.Printf("Unknown client message type: %s", message.Type)
	}
}