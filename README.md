# Shopping List App

A modern, minimalist shopping list application built with pure HTML, CSS, and JavaScript. Organize your groceries efficiently with a clean, responsive interface.

## Features

- **Categorized Shopping Lists** - Organize items by Produce, Dairy, Meat & Seafood, and more
- **Smart Item Management** - Add items with quantity, priority levels, and optional notes
- **Search & Filter** - Quickly find items with search functionality and filter by status
- **Bulk Operations** - Mark multiple items as purchased/needed or delete selected items
- **Light/Dark Mode** - Toggle between light and dark themes with preference persistence
- **Responsive Design** - Works seamlessly on desktop, tablet, and mobile devices
- **Share Functionality** - Share your shopping list via native sharing or clipboard
- **Priority System** - Set High, Medium, or Low priority for items
- **Quantity Controls** - Adjust item quantities with intuitive +/- buttons

## Screenshots

![Shopping List App](screenshot.png)

## Getting Started

### Prerequisites

No dependencies required! This is a pure HTML/CSS/JavaScript application.

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/shopping-list.git
cd shopping-list
```

2. Open `shopping-list.html` in your web browser:
```bash
# On Windows
start shopping-list.html

# On macOS
open shopping-list.html

# On Linux
xdg-open shopping-list.html
```

That's it! The app runs entirely in your browser with no server required.

## Usage

### Adding Items
1. Use the sidebar form to add new items
2. Enter the item name (required)
3. Set quantity using +/- buttons or direct input
4. Choose a category from the dropdown
5. Set priority level (Low, Medium, High)
6. Add optional notes
7. Click "Add to list"

### Managing Items
- **Check off items** by clicking the checkbox when purchased
- **Adjust quantities** using the +/- buttons next to each item
- **Delete items** using the trash icon
- **Search items** using the search bar at the top
- **Filter items** by status (All, Needed, Purchased)

### Bulk Operations
- Use the bulk action buttons to:
  - Select multiple items
  - Mark items as purchased/needed
  - Delete selected items

### Themes
- Click the sun/moon icon to toggle between light and dark modes
- Your preference is automatically saved

### Sharing
- Click the "Share" button to share your list
- Uses native sharing on supported devices
- Falls back to clipboard copy on other devices

## Categories

The app includes 10 predefined categories:
- 🥕 Produce
- 🥛 Dairy
- 🥩 Meat & Seafood
- 🥫 Pantry
- 🧊 Frozen
- 🍞 Bakery
- 🥤 Beverages
- 🍿 Snacks
- 🧽 Household
- 💊 Health & Beauty

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Development

This project was developed using **Claude AI** with **Claude Code** - an AI-powered development assistant that helped create a modern, accessible shopping list application.

### Development Process
- **Design**: Created based on modern UI/UX principles with a clean, minimalist approach
- **Implementation**: Built with semantic HTML, CSS Grid/Flexbox, and vanilla JavaScript
- **Testing**: Tested across multiple browsers and device sizes
- **Accessibility**: Designed with keyboard navigation and screen reader support

### File Structure
```
shopping-list/
├── shopping-list.html    # Main application file
├── README.md            # This file
├── LICENSE              # MIT License
└── .gitignore          # Git ignore rules
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

- [ ] Add item templates/favorites
- [ ] Import/export shopping lists
- [ ] Meal planning integration
- [ ] Shopping history tracking
- [ ] Barcode scanning (PWA)
- [ ] Recipe-to-shopping-list conversion

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Developed with **Claude AI** using **Claude Code**
- Icons from Feather Icons
- Design inspiration from modern shopping apps
- Built for Soveticka

---

*Made with ❤️ by Claude AI with Claude Code*