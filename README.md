# Margin - Study Desk

A complete, offline-first study companion with AI tutor, flashcards, focus timer, and notes.

## Recent Improvements (v1.1)

### Stage 1: Security & Error Handling ✅
- **API Security**: Replaced direct API calls with secure backend proxy pattern
- **Timeout Handling**: Added 30-second timeout with graceful error messages
- **Memory Management**: Limited chat history to prevent memory leaks
- **File Validation**: Added file size limits (5MB), format checking, and error reporting

### Stage 2: Data Loss Prevention ✅
- **Confirmation Dialogs**: Added "Are you sure?" prompts before deleting cards/notes
- **Input Validation**: Field-level validation with helpful error messages
- **Character Limits**: Safe limits (front: 500, back: 1000, title: 200, body: 5000)
- **Success Feedback**: Import confirmations showing number of items added

### Stage 3: Accessibility & UX ✅
- **Keyboard Navigation**: Cards now flippable with Space/Enter, keyboard support for all buttons
- **Focus Indicators**: Color-coded focus states (blue for tutor, amber for cards, red for notes)
- **Hover Tooltips**: Icon buttons show tooltips on hover
- **Smooth Animations**: Subtle hover effects and transitions
- **Better Hints**: Updated UI text for keyboard users

### Stage 4: Code Structure & Performance ✅
- **Improved Shuffle**: Replaced Math.random sort with Fisher-Yates algorithm
- **Better Organization**: Clear section headers and comments
- **Removed Duplicates**: Consolidated utility functions
- **Cleaner Code**: Better function structure and variable naming

## Setup

### Frontend (StudyBuddy.html)
Open `StudyBuddy.html` in a modern browser. Works offline except for the Tutor tab.

### Backend (Tutor Feature)
The Tutor tab requires a backend server to securely handle API calls.

#### Installation
```bash
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm start
```

The server will run on `http://localhost:3000`

#### Environment Variables
Create a `.env` file:
```
ANTHROPIC_API_KEY=sk-ant-...your-key-here...
PORT=3000
```

## Features

### 📱 Tutor (Online)
- Ask unlimited questions about any subject
- Step-by-step explanations with concrete examples
- Chat history for context
- Requires internet connection

### 🎴 Flashcards (Offline)
- Create cards with front/back content
- Organize by subject
- Shuffle and study mode
- Track correct/missed cards
- Export/import as JSON

### ⏱️ Timer (Offline)
- Pomodoro-style work/break cycles
- Customizable durations (work, short break, long break)
- Progress ring visualization
- Audio alerts
- Cycle tracking

### 📝 Notes (Offline)
- Quick write-ups organized by subject
- Search across all notes
- Edit and delete notes
- Export/import as JSON
- Date tracking for each note

## Data & Persistence

- **Tutor**: Online only, no local storage
- **Flashcards, Timer, Notes**: Work completely offline, stored in browser session only
- **Export**: Use the "Export" buttons to save data before closing the tab
- **Import**: Use "Import" to restore previously exported data

## Browser Support

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires JavaScript enabled and modern Web APIs (Fetch, FileReader, LocalStorage).

## Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Send chat message | Enter (in Tutor tab) |
| Flip flashcard | Space or Enter |
| Navigate between tabs | Tab key |

## Architecture

```
StudyBuddy.html         - Single-page app (frontend)
├── CSS (embedded)      - Responsive design
└── JavaScript (embedded)- All app logic

server.js               - Express backend
├── /api/tutor         - Claude API proxy
└── /health            - Health check

.env                    - Configuration (API keys)
package.json            - Dependencies
```

## Security Notes

1. **API Keys**: Never commit .env files or expose API keys in frontend code
2. **Data**: All local data stays in your browser session
3. **Offline**: Flashcards, timer, notes work without any server
4. **File Uploads**: Validates file size (max 5MB) and format (JSON only)

## Troubleshooting

### "Could not reach the server"
- Make sure the backend is running: `npm start`
- Check that `http://localhost:3000` is accessible
- Verify your internet connection

### "Invalid JSON format"
- Only import files exported from Margin
- Ensure the file is not corrupted
- Check file size (max 5MB)

### Cards/Notes lost after refresh
- Data is session-only by design
- Use "Export" to save before closing the tab
- Import the file if you reopened the app

### Audio not working
- Check browser permissions for audio
- Ensure speakers are connected
- Try a different browser

## Future Enhancements

- [ ] Local storage for persistent session data
- [ ] Rate limiting and quota tracking
- [ ] Multi-device sync
- [ ] Study statistics and analytics
- [ ] Dark mode
- [ ] Mobile app
- [ ] Collaborative study sessions

## License

MIT

## Support

For bugs or suggestions, please review the code comments and check the console for error messages.

---

**Built with 💪 for focused learning**
