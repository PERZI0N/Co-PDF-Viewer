package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

const (
	ADMIN_PASSWORD = "vaidik@VIT"
	UPLOAD_DIR     = "./uploads"
	MAX_FILE_SIZE  = 10 << 20 // 10MB
	MAX_CLIENTS = 100
)

type Client struct {
	conn    *websocket.Conn
	isAdmin bool
	mu      sync.Mutex
}

type Message struct {
	Type     string `json:"type"`
	Password string `json:"password,omitempty"`
	Page     int    `json:"page,omitempty"`
	Filename string `json:"filename,omitempty"`
	Error    string `json:"error,omitempty"`
	IsAdmin  bool   `json:"isAdmin,omitempty"`
	Count    int    `json:"count,omitempty"`
}

var (
	clients    = make(map[*Client]bool)
	clientsMu  sync.RWMutex
	broadcast  = make(chan Message)
	register   = make(chan *Client)
	unregister = make(chan *Client)
	mutex      sync.RWMutex
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	clientsMu.RLock()
	if len(clients) >= MAX_CLIENTS {
		clientsMu.RUnlock()
		http.Error(w, "Too many connections", http.StatusTooManyRequests)
		return
	}
	clientsMu.RUnlock()
	client := &Client{
		conn:    conn,
		isAdmin: false,
	}

	register <- client
	updateUserCount()
	go handleClientMessages(client)
}

func handleClientMessages(client *Client) {
	defer func() {
		unregister <- client
		client.conn.Close()
	}()

	for {
		var msg Message
		err := client.conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		processMessage(client, msg)
	}
}

func processMessage(client *Client, msg Message) {
	switch msg.Type {
	case "auth":
		handleAuthentication(client, msg)
	case "page_change":
		handlePageChange(client, msg)
	}
}

func handleAuthentication(client *Client, msg Message) {
	if msg.Password == ADMIN_PASSWORD {
		client.isAdmin = true
		sendToClient(client, Message{
			Type:    "admin_status",
			IsAdmin: true,
		})
	} else {
		sendToClient(client, Message{
			Type:  "error",
			Error: "Invalid admin credentials",
		})
	}
}

func handlePageChange(client *Client, msg Message) {
	if client.isAdmin {
		broadcast <- msg
	}
}

func sendToClient(client *Client, msg Message) {
	client.mu.Lock()
	defer client.mu.Unlock()

	if err := client.conn.WriteJSON(msg); err != nil {
		log.Printf("Send to client error: %v", err)
	}
}

func broadcastMessage(msg Message) {
	mutex.RLock()
	defer mutex.RUnlock()

	for client := range clients {
		go func(c *Client) {
			sendToClient(c, msg)
		}(client)
	}
}

func updateUserCount() {
    clientsMu.RLock()
    count := len(clients)
    clientsMu.RUnlock()

    broadcastMessage(Message{
        Type:  "user_count",
        Count: count,
    })
}

func handleMessages() {
	for {
		select {
		case client := <-register:
			mutex.Lock()
			clients[client] = true
			mutex.Unlock()
			updateUserCount()

		case client := <-unregister:
			mutex.Lock()
			delete(clients, client)
			mutex.Unlock()
			updateUserCount()

		case message := <-broadcast:
			broadcastMessage(message)
		}
	}
}

func handleFileUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(MAX_FILE_SIZE); err != nil {
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}
	file, handler, err := r.FormFile("pdf")
	if err != nil {
		http.Error(w, "Error retrieving file", http.StatusBadRequest)
		return
	}
	defer file.Close()
	if filepath.Ext(handler.Filename) != ".pdf" {
		http.Error(w, "Invalid file type. Only PDFs allowed", http.StatusBadRequest)
		return
	}
	filename := fmt.Sprintf("%d_%s", time.Now().Unix(), handler.Filename)
	filePath := filepath.Join(UPLOAD_DIR, filename)
	if err := os.MkdirAll(UPLOAD_DIR, 0755); err != nil {
		http.Error(w, "Could not create upload directory", http.StatusInternalServerError)
		return
	}
	destFile, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Error creating destination file", http.StatusInternalServerError)
		return
	}
	defer destFile.Close()
	if _, err := io.Copy(destFile, file); err != nil {
		http.Error(w, "Error saving file", http.StatusInternalServerError)
		return
	}
	go func() {
		broadcast <- Message{
			Type:     "new_pdf",
			Filename: filename,
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"filename": filename,
		"fullUrl":  fmt.Sprintf("/uploads/%s", filename),
		"message":  "File uploaded successfully",
	})
	fmt.Print(filename)
}

func setupRoutes() *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/ws", handleWebSocket)
	r.HandleFunc("/upload", handleFileUpload).Methods("POST")
	r.PathPrefix("/uploads/").Handler(
		http.StripPrefix("/uploads/", http.FileServer(http.Dir(UPLOAD_DIR))),
	)

	return r
}

func main() {
	go handleMessages()

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"https://6733115a5c8bad7fcb48fb21--helpful-sawine-40cee4.netlify.app/"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	router := setupRoutes()
	handler := c.Handler(router)

	port := ":8080"
	fmt.Printf("Server starting on port %s...\n", port)
	log.Fatal(http.ListenAndServe(port, handler))
}
