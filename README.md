# Nostr IM - Decentralized Instant Messaging

A modern, decentralized instant messaging application built on the Nostr protocol. This app provides secure, censorship-resistant communication with a beautiful, responsive user interface.

## Features

- 🔐 **Decentralized Authentication**: Uses Nostr's public/private key system
- 💬 **Direct Messaging**: Send encrypted messages to other Nostr users
- 👥 **Group Chats**: Create and manage group conversations
- 🔒 **End-to-End Encryption**: Messages are encrypted for privacy
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🎨 **Modern UI**: Beautiful, intuitive interface with smooth animations
- ⚡ **Real-time**: Instant message delivery through Nostr relays

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Protocol**: Nostr (Notes and Other Stuff Transmitted by Relays)
- **Build Tool**: Vite
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd nostr-im
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
# 创建 .env 文件
touch .env
```

4. Configure your Nostr private key in `.env`:
```env
# Nostr 私钥配置（公钥会自动推导）
VITE_NOSTR_PRIVATE_KEY=your_64_character_hex_private_key
```

5. Install dependencies (including dotenv):
```bash
npm install
```

6. Start the development server:
```bash
npm run dev
```

7. Open your browser and navigate to `http://localhost:3000`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Usage

### First Time Setup

1. **Create Account**: Generate a new Nostr keypair or import an existing private key
2. **Complete Profile**: Set up your display name and profile information
3. **Start Messaging**: Create direct messages or group chats with other Nostr users

### Key Features

#### Authentication
- Generate new Nostr keys for a fresh account
- Import existing private keys to use your current Nostr identity
- Keys are stored locally and never shared

#### Messaging
- Send direct messages to any Nostr user
- Create group chats with multiple participants
- Real-time message delivery
- Message encryption for privacy

#### User Interface
- Clean, modern design
- Responsive layout for all devices
- Smooth animations and transitions
- Intuitive navigation

## Architecture

### Core Components

- **NostrClient**: Handles Nostr protocol interactions
- **useNostr Hook**: React hook for Nostr functionality
- **Chat Components**: UI components for messaging interface
- **Auth Components**: Login and profile setup interfaces

### Nostr Integration

The app uses the Nostr protocol for:
- User authentication via public/private keys
- Message publishing to relays
- Real-time event subscription
- Profile metadata management

## Security

- **Local Key Storage**: Private keys are stored locally in browser storage
- **Message Encryption**: Messages are encrypted before transmission
- **Decentralized**: No central server to compromise
- **Censorship Resistant**: Messages are distributed across multiple relays

## Development

### Project Structure

```
src/
├── components/          # React components
│   ├── Auth/           # Authentication components
│   ├── Chat/           # Chat interface components
│   └── ui/             # Reusable UI components
├── hooks/              # Custom React hooks
├── lib/                # Utility libraries
├── types/              # TypeScript type definitions
└── App.tsx             # Main application component
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Built on the [Nostr protocol](https://nostr.com/)
- Uses [nostr-tools](https://github.com/nbd-wtf/nostr-tools) for Nostr functionality
- Inspired by decentralized messaging principles

## Support

For questions or support, please open an issue on GitHub.

---

**Note**: This is a demonstration application. For production use, ensure proper security audits and implement additional security measures as needed.
