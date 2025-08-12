# Shopping List App

A modern, full-stack shopping list application with user authentication, database persistence, and Docker containerization. Built with Python Flask backend and a clean HTML/CSS/JavaScript frontend.

## Features

### Core Functionality
- **User Authentication** - Secure registration and login with JWT tokens
- **Multi-User Support** - Each user has their own shopping lists and data
- **Categorized Shopping Lists** - Organize items by Produce, Dairy, Meat & Seafood, and more
- **Smart Item Management** - Add items with quantity, priority levels, and optional notes
- **Database Persistence** - All data stored in PostgreSQL database
- **Sample Data** - New users automatically get example shopping lists with sample items

### Advanced Features
- **Grocery Memory** - Remembers frequently used items with autocomplete suggestions
- **Intelligent Autocomplete** - Start typing to see suggestions from your purchase history
- **Search & Filter** - Quickly find items with search functionality
- **Priority System** - Set High, Medium, or Low priority for items
- **Quantity Controls** - Adjust item quantities with intuitive +/- buttons
- **Light/Dark Mode** - Toggle between light and dark themes with preference persistence
- **Responsive Design** - Works seamlessly on desktop, tablet, and mobile devices
- **Docker Support** - Full containerization with PostgreSQL, Python backend, and Nginx frontend

## Architecture

### Backend (Python Flask)
- **Authentication**: JWT-based user authentication
- **Database**: PostgreSQL with proper schema relationships
- **API**: RESTful endpoints for all operations
- **Security**: Password hashing with bcrypt, CORS protection

### Frontend (HTML/CSS/JavaScript)
- **Modern UI**: Clean, minimalist design with sidebar layout
- **Authentication Modals**: Registration and login forms
- **Real-time Updates**: Dynamic content loading via API
- **Responsive**: Mobile-first design with CSS Grid/Flexbox

### Database Schema
- **Users**: User accounts with authentication
- **Shopping Lists**: User-owned shopping lists
- **Shopping List Items**: Items within lists with categories and metadata
- **Grocery Memory**: Autocomplete suggestions based on user history

## Database Diagram

![Database Schema](database-diagram.drawio.png)

The database consists of 5 main tables with the following relationships:

### Core Tables
- **🟣 users**: Authentication and user management
- **🔵 shopping_lists**: User-owned shopping lists with sharing capability
- **🟢 shopping_list_items**: Individual grocery items with categories and priorities
- **🟡 grocery_memory**: Autocomplete suggestions based on user shopping patterns
- **🔴 list_shares**: Future feature for sharing lists between users

### Key Relationships
- **Users → Shopping Lists** (1:N): Each user can own multiple shopping lists
- **Shopping Lists → Items** (1:N): Each list contains multiple grocery items
- **Users → Grocery Memory** (1:N): Each user has personalized autocomplete data
- **Lists ↔ Users** (M:N): Future sharing via `list_shares` junction table

### Database Features
- **Cascade Deletion**: Automatic cleanup when users are deleted
- **Automatic Timestamps**: `created_at` and `updated_at` managed by triggers  
- **Performance Indexes**: Optimized for common queries
- **Unique Constraints**: Prevent duplicate data
- **Sample Data**: New users get example items automatically

*View the interactive diagram: Open `database-diagram.drawio` in [draw.io](https://app.diagrams.net/)*

## Getting Started

### Prerequisites
- Docker and Docker Compose
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/shopping-list.git
cd shopping-list
```

2. Start the application with Docker Compose:
```bash
docker-compose up -d
```

3. Open your browser and go to: `http://localhost:3000`

### Docker Services
- **Frontend**: Nginx serving the HTML application on port 3000
- **Backend**: Python Flask API server on port 3001  
- **Database**: PostgreSQL database with automatic schema initialization

## Usage

### User Registration & Login
1. Open the app and click "Login" to access the authentication modal
2. New users can register with username, email, and password
3. Existing users can log in with email and password
4. New users automatically receive an example shopping list with 5 sample items

### Managing Shopping Lists
- **View Lists**: All your shopping lists are automatically loaded
- **Add Items**: Use the sidebar form to add new items with categories and priorities
- **Edit Items**: Modify quantities, mark as complete, or delete items
- **Autocomplete**: Start typing to see suggestions from your purchase history

### Sample Items for New Users
New users automatically receive a shopping list with these sample items:
- Milk (Dairy, Medium priority) - "Organic preferred"
- Bananas (Produce, Low priority) - "Not too ripe"  
- Chicken Breast (Meat, High priority) - "1 lb package"
- Bread (Bakery, Medium priority) - "Whole wheat"
- Greek Yogurt (Dairy, Low priority) - "Vanilla flavor"

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user info

### Shopping Lists
- `GET /api/lists` - Get user's shopping lists
- `POST /api/lists` - Create new shopping list
- `GET /api/lists/{id}` - Get specific list with items
- `POST /api/lists/{id}/items` - Add item to list

### Grocery Memory
- `GET /api/groceries/memory` - Get autocomplete suggestions
- `GET /api/groceries/frequent` - Get frequently used items
- `GET /api/groceries/stats` - Get usage statistics

## File Structure
```
shopping-list/
├── shopping-list.html          # Frontend application
├── backend/
│   ├── app.py                 # Flask API server
│   ├── requirements.txt       # Python dependencies
│   ├── Dockerfile            # Backend container config
│   └── database/
│       └── schema.sql        # Database schema
├── docker-compose.yml         # Multi-service orchestration
├── Dockerfile                 # Frontend container config
├── nginx.conf                # Nginx configuration
├── .gitignore               # Git ignore rules
└── README.md                # This file
```

## Development

### Docker Commands
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f [service_name]

# Rebuild after changes
docker-compose up --build -d [service_name]

# Stop services
docker-compose down

# Database access
docker exec -it shopping-list-db psql -U shopping_user -d shopping_list
```

### Backend Development
- Built with Flask and Flask-JWT-Extended
- PostgreSQL database with psycopg2 driver
- Bcrypt password hashing
- CORS enabled for frontend communication
- Comprehensive error handling and validation

### Frontend Development
- Vanilla JavaScript with modern ES6+ features
- CSS Grid/Flexbox responsive layout
- JWT token management with localStorage
- RESTful API integration
- Modern authentication UI with modals

## Browser Support
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Security Features
- JWT token-based authentication
- Password hashing with bcrypt
- CORS protection
- SQL injection prevention with parameterized queries
- Input validation and sanitization

## Troubleshooting

### Common Issues
1. **"No shopping list available"**: Usually resolved by user registration/login
2. **JWT token errors**: Fixed by ensuring string-based token identities
3. **Database connection issues**: Check PostgreSQL service status

### Debug Information
The backend includes comprehensive logging for troubleshooting user registration and list creation.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Future Roadmap

- [ ] Shared shopping lists between users
- [ ] Real-time collaboration
- [ ] Mobile app (PWA)
- [ ] Import/export functionality
- [ ] Recipe integration
- [ ] Shopping history analytics
- [ ] Barcode scanning

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Developed with Claude AI using Claude Code**
- PostgreSQL for robust data persistence
- Flask for the lightweight Python backend
- Docker for seamless deployment
- Built for Soveticka

---

*🤖 Generated with [Claude Code](https://claude.ai/code)*

*Co-Authored-By: Claude <noreply@anthropic.com>*