import { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { getPublicKey, finalizeEvent, generateSecretKey } from 'nostr-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// Jotai atoms
import { atom } from 'jotai';

const userAtom = atom<{name: string, pubkey: string, privateKey: string} | null>(null);
const messagesAtom = atom<Array<{id: string, text: string, sender: string, time: number, event?: any}>>([]);
const wsConnectionsAtom = atom<WebSocket[]>([]);
const userProfilesAtom = atom<Record<string, {name: string, about?: string, picture?: string}>>({});
const subscribedUsersAtom = atom<Set<string>>(new Set<string>());

  // Global connection storage to avoid state update timing issues
  let globalConnections: WebSocket[] = [];
  
  // Global user info storage to avoid state update timing issues
  let globalUser: {name: string, pubkey: string, privateKey: string} | null = null;

function App() {
  const [step, setStep] = useState<'login' | 'chat'>('login');
  const [loginMode, setLoginMode] = useState<'signin' | 'signup'>('signin');
  const [user, setUser] = useAtom(userAtom);
  const [messages, setMessages] = useAtom(messagesAtom);
  const [newMessage, setNewMessage] = useState('');
  const [relays] = useState(['wss://relay.damus.io', 'wss://relay.snort.social']);
  const [wsConnections, setWsConnections] = useAtom(wsConnectionsAtom);
  const [userProfiles, setUserProfiles] = useAtom(userProfilesAtom);
  const [subscribedUsers, setSubscribedUsers] = useAtom(subscribedUsersAtom);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Debug log: track subscribedUsers changes
  useEffect(() => {
    if (subscribedUsers.size > 0) {
      console.log("📊 subscribedUsers updated:", subscribedUsers.size, "users");
    }
  }, [subscribedUsers]);
  
  // Function to scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Auto scroll to bottom when messages update
  useEffect(() => {
    scrollToBottom();
  }, [messages]);



  // Subscribe to all users' profiles
  const subscribeAllProfiles = (usersToSubscribe?: Set<string>) => {
    const currentSubscribedUsers = usersToSubscribe || subscribedUsers;
    const currentConnections = globalConnections.length > 0 ? globalConnections : wsConnections;
    
    if (currentSubscribedUsers.size === 0) {
      console.log("📊 No users to subscribe to");
      return;
    }

    const allUsers = Array.from(currentSubscribedUsers);
    const sub = {
      id: `profiles_all`,
      filters: [{
        kinds: [0], // Profile metadata
        authors: allUsers // Subscribe to all subscribed users' profiles
      }]
    };

    console.log("📡 Subscribing to profiles for", allUsers.length, "users");

    currentConnections.forEach((ws, index) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
        console.log(`📡 Sent profile subscription to relay ${index}`);
      }
    });
  };

  // Subscribe to specific user's profile event
  const subscribeToUserProfile = (pubkey: string) => {
    const currentConnections = globalConnections.length > 0 ? globalConnections : wsConnections;
    
    if (currentConnections.length === 0) {
      console.log('⚠️ No connections available for profile subscription');
      return;
    }

    const sub = {
      id: `profile_${pubkey}`,
      filters: [{
        kinds: [0], // Profile metadata
        authors: [pubkey]
      }]
    };

    console.log(`📡 Subscribing to profile for user: ${pubkey.substring(0, 8)}...`);

    currentConnections.forEach((ws, index) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
        console.log(`📡 Sent profile subscription to relay ${index}`);
      }
    });
  };

  // Add user to subscription list and immediately subscribe
  const addUserToSubscription = (pubkey: string) => {
    if (subscribedUsers.has(pubkey)) {
      return;
    }

    console.log(`👤 Adding new user: ${pubkey.substring(0, 8)}...`);
    
    // Create new user set
    const newSet = new Set([...subscribedUsers, pubkey]);
    
    // Immediately subscribe to all users (including new user), pass new user set
    subscribeAllProfiles(newSet);
    
    // Then update state
    setSubscribedUsers(newSet);
  };

  
  // Get current website channel ID
  const getChannelId = () => {
    let currEnv = "test"
    if (process.env.NODE_ENV === 'production') {
      currEnv = "prod"
    }
    return "nostr_im_of_sawyer_" + currEnv + "_" + window.location.hostname + window.location.pathname;
  };

  // Cleanup WebSocket connections on unmount
  useEffect(() => {
    return () => {
      wsConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    };
  }, [wsConnections]);

  // Function to derive public key from private key
  const derivePublicKey = (privateKey: string): string => {
    try {
      // Convert string private key to hex format
      const privateKeyHex = privateKey.length === 64 ? privateKey : 
        Array.from(privateKey).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').substring(0, 64);
      
      // Convert hex string to Uint8Array
      const privateKeyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        const hex = privateKeyHex.substring(i * 2, i * 2 + 2);
        privateKeyBytes[i] = parseInt(hex, 16);
      }
      
      // Use nostr-tools to generate public key
      return getPublicKey(privateKeyBytes);
    } catch (error) {
      console.error('Public key derivation failed:', error);
      // Fallback to simple hash
      const hash = privateKey.split('').reduce((acc, char) => {
        const byte = char.charCodeAt(0);
        acc = ((acc << 5) - acc) + byte;
        return acc & acc;
      }, 0);
      return Math.abs(hash).toString(16).padStart(64, '0').substring(0, 64);
    }
  };


  // Generate signature (using nostr-tools)
  const generateSignature = (privateKey: string, event: any): string => {
    try {
      // Convert string private key to hex format
      const privateKeyHex = privateKey.length === 64 ? privateKey : 
        Array.from(privateKey).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').substring(0, 64);
      
      // Convert hex string to Uint8Array
      const privateKeyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        const hex = privateKeyHex.substring(i * 2, i * 2 + 2);
        privateKeyBytes[i] = parseInt(hex, 16);
      }
      
      // Use nostr-tools to sign event
      const signedEvent = finalizeEvent(event, privateKeyBytes);
      
      // Ensure signature is 64 bytes (128 hex characters)
      const sig = signedEvent.sig;
      if (sig.length === 128) {
        return sig;
      } else {
        // If length is incorrect, use fallback
        console.warn('Signature length incorrect:', sig.length, 'expected 128');
        return sig.padStart(128, '0').substring(0, 128);
      }
    } catch (error) {
      console.error('Signature generation failed:', error);
      // Fallback to simple hash
      const hash = (privateKey + event.id).split('').reduce((acc, char, index) => {
        const byte = char.charCodeAt(0);
        acc = ((acc << 5) - acc) + byte + index;
        return acc & acc;
      }, 0);
      return Math.abs(hash).toString(16).padStart(128, '0').substring(0, 128);
    }
  };

  const handleSignIn = (privateKeyInput: string) => {
         if (!privateKeyInput?.trim()) {
           // Use more user-friendly prompt
           const privateKeyInput = document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement;
           if (privateKeyInput) {
             privateKeyInput.focus();
             privateKeyInput.style.borderColor = 'hsl(var(--destructive))';
             privateKeyInput.placeholder = 'Please enter your private key';
             setTimeout(() => {
               privateKeyInput.style.borderColor = '';
               privateKeyInput.placeholder = 'Enter your private key';
             }, 3000);
           }
           return;
         }
    
    const privateKey = privateKeyInput.trim();
    console.log('🔐 Sign In with private key:', privateKey.substring(0, 8) + '...');
    
    // Derive public key from private key
    const pubkey = derivePublicKey(privateKey);
    
    console.log('Using keys:', { 
      privateKey: privateKey.substring(0, 8) + '...', 
      pubkey: pubkey.substring(0, 8) + '...',
      source: 'user_input'
    });
    
    // Set user info first, temporarily use public key prefix as username
    const userInfo = { name: `User_${pubkey.substring(0, 8)}`, pubkey, privateKey };
    setUser(userInfo);
    globalUser = userInfo; // Also update global user info
    setStep('chat');
    
    // Add self to subscription list
    addUserToSubscription(pubkey);
    
    // Connect to relays
    connectToRelays();
    
    // Subscribe to own profile event to get real username
    setTimeout(() => {
      subscribeToUserProfile(pubkey);
    }, 1000);
  };

  const handleSignUp = (name: string) => {
    console.log('🔐 Sign Up - generating new key for:', name);
    
    // Generate new private key
    const generatedKey = generateSecretKey();
    const privateKey = Array.from(generatedKey).map(b => b.toString(16).padStart(2, '0')).join('');
    
           // Show private key save prompt
           const showPrivateKeyModal = () => {
             const modal = document.createElement('div');
             modal.className = 'fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50';
             modal.innerHTML = `
               <div class="bg-card border border-border rounded-lg p-6 max-w-md mx-4 shadow-lg">
                 <div class="text-center mb-4">
                   <div class="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
                     <span class="text-xl text-muted-foreground">🔑</span>
                   </div>
                   <h3 class="text-lg font-semibold text-foreground mb-2">Private Key Generated</h3>
                   <p class="text-sm text-muted-foreground">Please save your private key securely</p>
                 </div>
                 
                 <div class="bg-muted rounded-lg p-3 mb-4">
                   <p class="text-xs text-muted-foreground mb-1">Your private key:</p>
                   <p class="text-sm font-mono break-all text-foreground">${privateKey}</p>
                 </div>
                 
                 <div class="bg-muted border border-border rounded-lg p-3 mb-4">
                   <p class="text-xs text-muted-foreground">
                     ⚠️ This is your only way to access your account. Keep it safe.
                   </p>
                 </div>
                 
                 <div class="flex gap-3">
                   <button id="copyKey" class="flex-1 bg-primary text-primary-foreground py-2 px-4 rounded-md font-medium hover:bg-primary/90 transition-colors">
                     Copy Key
                   </button>
                   <button id="continueBtn" class="flex-1 bg-secondary text-secondary-foreground py-2 px-4 rounded-md font-medium hover:bg-secondary/80 transition-colors">
                     Continue
                   </button>
                 </div>
                 
                 <button id="cancelBtn" class="w-full mt-2 text-muted-foreground hover:text-foreground text-sm">
                   Cancel
                 </button>
               </div>
             `;
      
      document.body.appendChild(modal);
      
             // Copy private key functionality
             modal.querySelector('#copyKey')?.addEventListener('click', () => {
               navigator.clipboard.writeText(privateKey).then(() => {
                 const btn = modal.querySelector('#copyKey') as HTMLButtonElement;
                 btn.textContent = 'Copied!';
                 btn.className = 'flex-1 bg-secondary text-secondary-foreground py-2 px-4 rounded-md font-medium transition-colors';
                 setTimeout(() => {
                   btn.textContent = 'Copy Key';
                   btn.className = 'flex-1 bg-primary text-primary-foreground py-2 px-4 rounded-md font-medium hover:bg-primary/90 transition-colors';
                 }, 2000);
               });
             });
      
      // Continue button
      modal.querySelector('#continueBtn')?.addEventListener('click', () => {
        document.body.removeChild(modal);
        proceedWithSignUp();
      });
      
      // Cancel button
      modal.querySelector('#cancelBtn')?.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      // Close on background click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });
    };
    
    const proceedWithSignUp = () => {
      // Derive public key from private key
      const pubkey = derivePublicKey(privateKey);
      
      console.log('Using keys:', { 
        privateKey: privateKey.substring(0, 8) + '...', 
        pubkey: pubkey.substring(0, 8) + '...',
        source: 'generated'
      });
      
      const userInfo = { name, pubkey, privateKey };
      setUser(userInfo);
      globalUser = userInfo; // Also update global user info
      setStep('chat');
      
      // Add self to subscription list
      addUserToSubscription(pubkey);
      
      // Connect to relays
      connectToRelays();
      
      // Send profile event (kind:0) when user comes online (delayed send, wait for connection)
      setTimeout(() => {
        sendProfileEvent(name, pubkey, privateKey);
      }, 2000);
    };
    
    // Show private key save modal
    showPrivateKeyModal();
  };

  // Send profile event (kind:0)
  const sendProfileEvent = async (name: string, pubkey: string, privateKey: string, connections?: WebSocket[]) => {
    try {
      const currentConnections = connections || globalConnections || wsConnections;
      
      const created_at = Math.floor(Date.now() / 1000);
      
      // Create profile event template
      const eventTemplate = {
        kind: 0, // Profile metadata
        tags: [],
        content: JSON.stringify({
          name: name,
          about: `Nostr IM user - ${name}`,
          picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${pubkey.substring(0, 8)}`
        }),
        created_at: created_at,
        pubkey: pubkey
      };
      
      // Generate signature using nostr-tools
      const signature = generateSignature(privateKey, eventTemplate);
      
      // Generate proper event ID using SHA256
      const eventContent = JSON.stringify([
        0,
        eventTemplate.pubkey,
        eventTemplate.created_at,
        eventTemplate.kind,
        eventTemplate.tags,
        eventTemplate.content
      ]);
      
      const encoder = new TextEncoder();
      const data = encoder.encode(eventContent);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const eventId = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Create final event with signature
      const event = {
        ...eventTemplate,
        id: eventId,
        sig: signature
      };
      
      // Send to all connected relays
      if (currentConnections.length === 0) {
        console.log(`⚠️ No WebSocket connections available, retrying in 1 second...`);
        setTimeout(() => {
          sendProfileEvent(name, pubkey, privateKey);
        }, 1000);
        return;
      }
      
      currentConnections.forEach((ws, index) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['EVENT', event]));
          console.log(`📤 Profile event sent to relay ${index}`);
        }
      });
      
    } catch (error) {
      console.error('Failed to send profile event:', error);
    }
  };

  const connectToRelays = () => {
    const connections: WebSocket[] = [];
    
    // Try to connect to relays, but don't fail if they don't work
    relays.forEach(relayUrl => {
      try {
        const ws = new WebSocket(relayUrl);
        ws.onopen = () => {
          console.log(`✅ Connected to ${relayUrl}`);
          // Subscribe to messages for this channel only
          const channelId = getChannelId();
           const sub = {
             id: `channel_${channelId}`,
             filters: [
              { 
               kinds: [1], // Text notes
               '#t': [channelId] // Only messages tagged with this channel
             }]
           };
          ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
          console.log(`📡 Subscribed to channel: ${channelId}`);
          
                 // After connection is established, subscribe to all subscribed users' profiles
                 setTimeout(() => {
                   if (subscribedUsers.size > 0) {
                     subscribeAllProfiles();
                   }
                 }, 500);
                 
                 // If current user is logged in, send profile event
                 if (user?.name && user?.pubkey && user?.privateKey) {
                   setTimeout(() => {
                     sendProfileEvent(user.name, user.pubkey, user.privateKey, [ws]);
                   }, 1000);
                 }
        };
        
         ws.onmessage = (event) => {
           try {
             const data = JSON.parse(event.data);
             if (data[0] === 'EVENT') {
               const event = data[2];
                  if (event.kind === 0) {
                    // console.log('Profile metadata received, event:', event);
                    // Profile metadata received
                    try {
                      const profile = JSON.parse(event.content);
                      const profileName = profile.name || `User_${event.pubkey.substring(0, 8)}`;
                      
                      setUserProfiles(prev => ({
                        ...prev,
                        [event.pubkey]: {
                          name: profileName,
                          about: profile.about,
                          picture: profile.picture
                        }
                      }));
                      
                      
                             if (globalUser && event.pubkey === globalUser.pubkey) {
                               const updatedUser = { ...globalUser, name: profileName };
                               setUser(updatedUser);
                               globalUser = updatedUser; // Also update global user info
                             }
                      console.log(`👤 Profile updated: ${profileName}`);
                    } catch (e) {
                      console.log('Failed to parse profile:', e);
                    }
                  } else if (event.kind === 1) {
                    // Text note received
                    const channelId = getChannelId();
                    
                    // Check if message belongs to current channel
                    const hasChannelTag = event.tags && event.tags.some((tag: any) => 
                      tag[0] === 't' && tag[1] === channelId
                    );
                     
                    if (hasChannelTag) {
                      // Add sender to subscription list
                      addUserToSubscription(event.pubkey);
                      
                      // For received messages, use event's own ID
                      const message = {
                        id: event.id || 'received_' + event.created_at + '_' + event.pubkey.substring(0, 8),
                        text: event.content,
                        sender: event.pubkey,
                        time: event.created_at * 1000,
                        event: event
                      };
                      setMessages(prev => {
                        // Check if message with same ID already exists to avoid duplicates
                        const exists = prev.some(msg => msg.id === message.id);
                        if (!exists) {
                          const newMessages = [...prev, message];
                          // Sort by time (old to new)
                          return newMessages.sort((a, b) => a.time - b.time);
                        } else {
                          console.log('⚠️ Duplicate message detected, skipping:', message.id);
                        }
                        return prev;
                      });
                      console.log(`📨 Message: ${event.content.substring(0, 50)}...`);
                    }
               }
             }
          } catch (e) {
            console.log('Received non-JSON message from relay:', e);
          }
         };
        
        ws.onerror = () => {
          console.log(`⚠️ WebSocket error for ${relayUrl} (this is normal for demo)`);
        };
        
        ws.onclose = () => {
          console.log(`🔌 Connection closed to ${relayUrl}`);
        };
        
        connections.push(ws);
      } catch (error) {
        console.log(`⚠️ Failed to connect to ${relayUrl} (this is normal for demo)`);
      }
    });
    
    setWsConnections(connections);
    globalConnections = connections; // Also update global connections
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    
    try {
      const channelId = getChannelId();
      const created_at = Math.floor(Date.now() / 1000);
      
             // Create Nostr event template
             const eventTemplate = {
               kind: 1, // Text note
               tags: [
                 ['t', channelId] // Channel tag
               ],
               content: newMessage,
               created_at: created_at,
               pubkey: user.pubkey
             };
      
      // Generate signature using nostr-tools
      const signature = generateSignature(user.privateKey, eventTemplate);
      
      // Generate proper event ID using SHA256
      const eventContent = JSON.stringify([
        0,
        eventTemplate.pubkey,
        eventTemplate.created_at,
        eventTemplate.kind,
        eventTemplate.tags,
        eventTemplate.content
      ]);
      
      const encoder = new TextEncoder();
      const data = encoder.encode(eventContent);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const eventId = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Create final event with signature
      const event = {
        ...eventTemplate,
        id: eventId,
        sig: signature
      };
      
      console.log('Event:', event);
      
      // Send to all connected relays
      wsConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['EVENT', event]));
        }
      });
      
      // Add to local messages
      const message = {
        id: event.id,
        text: newMessage,
        sender: user.pubkey,
        time: Date.now(),
        event: event
      };
      
      setMessages(prev => {
        // Check if message with same ID already exists to avoid duplicates
        const exists = prev.some(msg => msg.id === message.id);
        if (!exists) {
          const newMessages = [...prev, message];
          // Sort by time (old to new)
          return newMessages.sort((a, b) => a.time - b.time);
        } else {
          console.log('⚠️ Duplicate sent message detected, skipping:', message.id);
        }
        return prev;
      });
      setNewMessage('');
      
      // Ensure sender is also subscribed to profile
      addUserToSubscription(user.pubkey);
       
       console.log(`📤 Message sent: ${newMessage.substring(0, 30)}...`);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  if (step === 'login') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border shadow-lg">
          <CardHeader className="text-center pb-8">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl text-muted-foreground">⚡</span>
            </div>
            <CardTitle className="text-2xl font-semibold text-foreground mb-2">
              Nostr IM
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Decentralized messaging
            </CardDescription>
            <div className="mt-4 flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-muted-foreground">Powered by Nostr Protocol</span>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Mode selection */}
            <div className="flex bg-muted rounded-lg p-1">
              <Button
                variant={loginMode === 'signin' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setLoginMode('signin')}
              >
                <span className="mr-2">🔑</span>
                Sign In
              </Button>
              <Button
                variant={loginMode === 'signup' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setLoginMode('signup')}
              >
                <span className="mr-2">✨</span>
                Sign Up
              </Button>
            </div>

            {loginMode === 'signin' ? (
              // Sign In form
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center">
                    <span className="mr-2">🔐</span>
                    Private Key
                  </label>
                  <Input
                    type="password"
                    placeholder="Enter your private key"
                    className="h-12"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const privateKey = (document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement)?.value;
                        if (privateKey?.trim()) {
                          handleSignIn(privateKey.trim());
                        }
                      }
                    }}
                  />
                </div>
                
                <Card className="bg-muted border-muted">
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-muted-foreground/10 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-muted-foreground text-sm">ℹ️</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          Sign In with Private Key
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Your username will be loaded from your profile automatically.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Button
                  onClick={() => {
                    const privateKey = (document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement)?.value;
                    if (privateKey?.trim()) {
                      handleSignIn(privateKey.trim());
                    }
                  }}
                  className="w-full h-12 text-lg"
                  size="lg"
                >
                  <span className="mr-2">🚀</span>
                  Sign In
                </Button>
              </div>
            ) : (
              // Sign Up form
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center">
                    <span className="mr-2">👤</span>
                    Username
                  </label>
                  <Input
                    type="text"
                    placeholder="Choose a username"
                    className="h-12"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const name = (document.querySelector('input[placeholder="Choose a username"]') as HTMLInputElement)?.value;
                        if (name?.trim()) {
                          handleSignUp(name.trim());
                        }
                      }
                    }}
                  />
                </div>
                
                <Card className="bg-muted border-muted">
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-muted-foreground/10 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-muted-foreground text-sm">🆕</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          New to Nostr?
                        </p>
                        <p className="text-sm text-muted-foreground">
                          We'll generate a new private key for you. Make sure to save it securely!
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Button
                  onClick={() => {
                    const name = (document.querySelector('input[placeholder="Choose a username"]') as HTMLInputElement)?.value;
                    if (name?.trim()) {
                      handleSignUp(name.trim());
                    }
                  }}
                  className="w-full h-12 text-lg"
                  size="lg"
                >
                  <span className="mr-2">✨</span>
                  Create Account
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex">
      {/* Sidebar */}
      <div className="w-80 bg-card border-r border-border flex flex-col">
        <Card className="border-0 rounded-none">
          <CardHeader className="pb-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <span className="text-lg text-muted-foreground">⚡</span>
              </div>
              <div>
                <CardTitle className="text-lg text-foreground">Nostr IM</CardTitle>
                <CardDescription className="text-muted-foreground">Decentralized Chat</CardDescription>
              </div>
            </div>
            
            <Card className="bg-muted border-muted">
              <CardContent className="p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-muted-foreground/20 text-muted-foreground text-sm">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{user?.name}</p>
                    <p className="text-muted-foreground text-xs font-mono break-all">
                      {user?.pubkey}
                    </p>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="bg-muted-foreground/10 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground font-medium mb-1">Current Channel</p>
                    <p className="text-xs text-foreground font-mono break-all">{getChannelId()}</p>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-xs text-muted-foreground">
                      Connected to {wsConnections.length} relays
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </CardHeader>
        </Card>
        
        <div className="flex-1 p-6">
          <div className="space-y-4">
            <Card className="bg-muted border-muted">
              <CardContent className="p-4">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-8 h-8 bg-muted-foreground/10 rounded-full flex items-center justify-center">
                    <span className="text-muted-foreground text-sm">💬</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Chat</h3>
                    <p className="text-sm text-muted-foreground">Your conversation</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-muted border-muted">
              <CardContent className="p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-8 h-8 bg-muted-foreground/10 rounded-full flex items-center justify-center">
                    <span className="text-muted-foreground text-sm">⚡</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium text-foreground text-sm">Nostr Protocol</h4>
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    </div>
                    <p className="text-xs text-muted-foreground">Decentralized messaging</p>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-muted-foreground">Messages</span>
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                    </div>
                    <Badge variant="secondary">{messages.length}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <Badge variant="outline" className="text-muted-foreground border-muted-foreground/20">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                      Online
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <Card className="bg-card border-b border-border rounded-none">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                <span className="text-muted-foreground text-xl">💬</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <CardTitle className="text-xl text-foreground">Chat</CardTitle>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                </div>
                <CardDescription className="text-muted-foreground">Connect with users on the same domain</CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <span className="text-4xl text-muted-foreground">💬</span>
                </div>
                <h3 className="text-2xl font-semibold text-foreground mb-3">Welcome to Nostr IM</h3>
                <p className="text-muted-foreground mb-6">Start the conversation by sending your first message</p>
                <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                  <span>⚡</span>
                  <span>Decentralized</span>
                </div>
              </div>
            </div>
          ) : (
             messages.map((msg) => {
               const isOwnMessage = msg.sender === user?.pubkey;
               const senderProfile = userProfiles[msg.sender];
               const senderName = isOwnMessage ? user?.name : (senderProfile?.name || `User_${msg.sender.substring(0, 8)}`);
               
               return (
                 <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group`}>
                   <Card className={`max-w-lg shadow-sm transition-all duration-200 hover:shadow-md ${
                     isOwnMessage 
                       ? 'bg-primary text-primary-foreground border-0' 
                       : 'bg-card text-card-foreground border-border'
                   }`}>
                     <CardContent className="p-4">
                       {!isOwnMessage && (
                         <div className="mb-3 flex items-start space-x-2">
                           <Avatar className="w-6 h-6 flex-shrink-0">
                             <AvatarFallback className="bg-muted-foreground/20 text-muted-foreground text-xs">
                               {senderName.charAt(0).toUpperCase()}
                             </AvatarFallback>
                           </Avatar>
                           <div className="flex-1 min-w-0">
                             <p className="text-xs font-medium text-foreground truncate">
                               {senderName}
                             </p>
                             <p className="text-xs text-muted-foreground font-mono break-all leading-tight">
                               {msg.sender}
                             </p>
                           </div>
                         </div>
                       )}
                       <p className="text-sm leading-relaxed mb-2 break-words whitespace-pre-wrap">{msg.text}</p>
                       <div className="flex items-center justify-between">
                         <p className={`text-xs ${
                           isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'
                         }`}>
                           {new Date(msg.time).toLocaleTimeString()}
                         </p>
                         <div className="flex items-center gap-1">
                           <Badge variant="outline" className={`text-xs ${isOwnMessage ? 'border-primary-foreground/30 text-primary-foreground/70' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                             ✓ Nostr
                           </Badge>
                         </div>
                       </div>
                     </CardContent>
                   </Card>
                 </div>
               );
              })
           )}
           <div ref={messagesEndRef} />
         </div>

        {/* Message Input */}
        <Card className="bg-card border-t border-border rounded-none">
          <CardContent className="p-6">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type a message..."
                  className="h-12 pr-12"
                />
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                  <span className="text-muted-foreground">💬</span>
                </div>
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim()}
                className="h-12 px-8"
                size="lg"
              >
                <span className="mr-2">🚀</span>
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default App;