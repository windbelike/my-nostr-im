import { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { getPublicKey, finalizeEvent, generateSecretKey } from 'nostr-tools';

// Jotai atoms
import { atom } from 'jotai';

const userAtom = atom<{name: string, pubkey: string, privateKey: string} | null>(null);
const messagesAtom = atom<Array<{id: string, text: string, sender: string, time: number, event?: any}>>([]);
const wsConnectionsAtom = atom<WebSocket[]>([]);
const userProfilesAtom = atom<Record<string, {name: string, about?: string, picture?: string}>>({});
const subscribedUsersAtom = atom<Set<string>>(new Set<string>());

// 全局连接存储，避免状态更新时机问题
let globalConnections: WebSocket[] = [];

function App() {
  const [step, setStep] = useState<'login' | 'chat'>('login');
  const [user, setUser] = useAtom(userAtom);
  const [messages, setMessages] = useAtom(messagesAtom);
  const [newMessage, setNewMessage] = useState('');
  const [relays] = useState(['wss://relay.damus.io', 'wss://relay.snort.social']);
  const [wsConnections, setWsConnections] = useAtom(wsConnectionsAtom);
  const [userProfiles, setUserProfiles] = useAtom(userProfilesAtom);
  const [subscribedUsers, setSubscribedUsers] = useAtom(subscribedUsersAtom);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 调试日志：跟踪subscribedUsers变化
  useEffect(() => {
    console.log("📊 subscribedUsers updated:", Array.from(subscribedUsers).map(pk => pk.substring(0, 8) + "..."));
  }, [subscribedUsers]);
  
  // 滚动到底部的函数
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // 当消息更新时自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages]);



  // 订阅所有用户的个人资料
  const subscribeAllProfiles = (usersToSubscribe?: Set<string>) => {
    const currentSubscribedUsers = usersToSubscribe || subscribedUsers;
    const currentConnections = globalConnections.length > 0 ? globalConnections : wsConnections;
    
    console.log("📊 subscribeAllProfiles called with users:", currentSubscribedUsers.size);
    console.log("📊 Current subscribedUsers state:", subscribedUsers.size);
    
    if (currentSubscribedUsers.size === 0) {
      console.log("📊 No users to subscribe to");
      return;
    }

    const allUsers = Array.from(currentSubscribedUsers);
    const sub = {
      id: `profiles_all`,
      filters: [{
        kinds: [0], // Profile metadata
        authors: allUsers // 订阅所有已订阅用户的个人资料
      }]
    };

    console.log("📡 Subscribing to profiles for users:", allUsers.map(pk => pk.substring(0, 8) + "..."));
    console.log("📡 Using connections:", currentConnections.length);

    currentConnections.forEach((ws, index) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
        console.log(`📡 Sent profile subscription to relay ${index}`);
      } else {
        console.log(`⚠️ Relay ${index} not ready, state: ${ws.readyState}`);
      }
    });
  };

  // 添加用户到订阅列表并立即订阅
  const addUserToSubscription = (pubkey: string) => {
    if (subscribedUsers.has(pubkey)) {
      console.log(`👤 User already subscribed: ${pubkey.substring(0, 8)}...`);
      return;
    }

    console.log(`👤 Adding new user: ${pubkey.substring(0, 8)}...`);
    
    // 创建新的用户集合
    const newSet = new Set([...subscribedUsers, pubkey]);
    console.log(`👤 New user set size: ${newSet.size}`);
    
    // 立即订阅所有用户（包括新用户），传递新的用户集合
    subscribeAllProfiles(newSet);
    
    // 然后更新状态
    setSubscribedUsers(newSet);
  };

  // 强制订阅所有用户（调试用）
  const forceSubscribeAll = () => {
    console.log("🚀 Force subscribing to all users...");
    console.log("Current subscribedUsers:", Array.from(subscribedUsers));
    console.log("Current wsConnections:", wsConnections.length);
    subscribeAllProfiles();
  };
  
  // 获取当前网站渠道ID
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

  // 从私钥推导公钥的函数
  const derivePublicKey = (privateKey: string): string => {
    try {
      // 将字符串私钥转换为hex格式
      const privateKeyHex = privateKey.length === 64 ? privateKey : 
        Array.from(privateKey).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').substring(0, 64);
      
      // 将hex字符串转换为Uint8Array
      const privateKeyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        const hex = privateKeyHex.substring(i * 2, i * 2 + 2);
        privateKeyBytes[i] = parseInt(hex, 16);
      }
      
      // 使用nostr-tools生成公钥
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


  // 生成签名（使用nostr-tools）
  const generateSignature = (privateKey: string, event: any): string => {
    try {
      // 将字符串私钥转换为hex格式
      const privateKeyHex = privateKey.length === 64 ? privateKey : 
        Array.from(privateKey).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').substring(0, 64);
      
      // 将hex字符串转换为Uint8Array
      const privateKeyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        const hex = privateKeyHex.substring(i * 2, i * 2 + 2);
        privateKeyBytes[i] = parseInt(hex, 16);
      }
      
      // 使用nostr-tools签名事件
      const signedEvent = finalizeEvent(event, privateKeyBytes);
      
      // 确保签名是64字节（128位十六进制字符串）
      const sig = signedEvent.sig;
      if (sig.length === 128) {
        return sig;
      } else {
        // 如果长度不对，使用fallback
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

  const handleLogin = (name: string, privateKeyInput: string) => {
    let privateKey = privateKeyInput.trim();
    
    // 如果用户没有输入私钥，自动生成一个
    if (!privateKey) {
      const generatedKey = generateSecretKey();
      privateKey = Array.from(generatedKey).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // 弹窗提示用户保存私钥
      const saveKey = confirm(
        `🔑 已为您生成新的私钥！\n\n` +
        `私钥: ${privateKey}\n\n` +
        `⚠️ 请务必保存好您的私钥！\n` +
        `私钥是您身份的唯一凭证，丢失后将无法恢复。\n\n` +
        `点击"确定"继续，点击"取消"重新输入私钥。`
      );
      
      if (!saveKey) {
        return; // 用户取消，重新输入
      }
    }
    
    // 从私钥推导公钥
    const pubkey = derivePublicKey(privateKey);
    
    console.log('Using keys:', { 
      privateKey: privateKey.substring(0, 8) + '...', 
      pubkey: pubkey.substring(0, 8) + '...',
      source: privateKeyInput.trim() ? 'user_input' : 'generated'
    });
    
     setUser({ name, pubkey, privateKey });
     setStep('chat');
     
     // 添加自己到订阅列表
     addUserToSubscription(pubkey);
     
     // Connect to relays
     connectToRelays();
     
     // Send profile event (kind:0) when user comes online (延迟发送，等待连接建立)
     setTimeout(() => {
       sendProfileEvent(name, pubkey, privateKey);
     }, 2000);
  };

  // 发送个人资料事件 (kind:0)
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
      console.log(`📤 Attempting to send profile event, connections:`, currentConnections.length);
      if (currentConnections.length === 0) {
        console.log(`⚠️ No WebSocket connections available, retrying in 1 second...`);
        setTimeout(() => {
          sendProfileEvent(name, pubkey, privateKey);
        }, 1000);
        return;
      }
      
      console.log("currentConnections on sendProfileEvent: ", currentConnections);
      currentConnections.forEach((ws, index) => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`📤 Profile event sent to relay ${index}:`, event);
          ws.send(JSON.stringify(['EVENT', event]));
        } else {
          console.log(`⚠️ Relay ${index} not ready, state: ${ws.readyState}`);
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
          console.log(`📋 Subscription filters:`, sub.filters);
          
          // 连接建立后，订阅所有已订阅用户的个人资料
          setTimeout(() => {
            console.log("🔌 Connection established, checking for users to subscribe...");
            if (subscribedUsers.size > 0) {
              console.log(`📡 Found ${subscribedUsers.size} users to subscribe`);
              subscribeAllProfiles();
            } else {
              console.log("📊 No users to subscribe yet");
            }
          }, 500);
          
          // 如果当前用户已登录，发送个人资料事件
          if (user?.name && user?.pubkey && user?.privateKey) {
            setTimeout(() => {
              console.log(`📤 Sending profile event for current user: ${user.pubkey.substring(0, 8)}...`);
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
                 // Profile metadata received
                 console.log("kind:0 profile event received, event:" + JSON.stringify(event));
                 try {
                   const profile = JSON.parse(event.content);
                   setUserProfiles(prev => ({
                     ...prev,
                     [event.pubkey]: {
                       name: profile.name || `User_${event.pubkey.substring(0, 8)}`,
                       about: profile.about,
                       picture: profile.picture
                     }
                   }));
                   console.log(`👤 Profile updated for ${event.pubkey}:`, profile.name);
                 } catch (e) {
                   console.log('Failed to parse profile:', e);
                 }
               } else if (event.kind === 1) {
                 // Text note received
                 const channelId = getChannelId();
                 console.log("kind:1 text note received, event:" + JSON.stringify(event));
                 
                 // 检查消息是否属于当前渠道
                 const hasChannelTag = event.tags && event.tags.some((tag: any) => 
                   tag[0] === 't' && tag[1] === channelId
                 );
                  
                 if (hasChannelTag) {
                   // 添加发送者到订阅列表
                   addUserToSubscription(event.pubkey);
                   
                   // 对于接收到的消息，使用事件自带的ID
                   const message = {
                     id: event.id || 'received_' + event.created_at + '_' + event.pubkey.substring(0, 8),
                     text: event.content,
                     sender: event.pubkey,
                     time: event.created_at * 1000,
                     event: event
                   };
                   setMessages(prev => {
                     // 检查是否已存在相同ID的消息，避免重复
                     const exists = prev.some(msg => msg.id === message.id);
                     if (!exists) {
                       return [...prev, message];
                     }
                     return prev;
                   });
                   console.log(`📨 Received message for channel ${channelId}:`, event.content);
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
    globalConnections = connections; // 同时更新全局连接
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
           ['t', channelId] // Channel tag - 渠道标签
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
      
       setMessages(prev => [...prev, message]);
       setNewMessage('');
       
       // 确保发送者也被订阅个人资料
       addUserToSubscription(user.pubkey);
       
       console.log(`📤 Message sent to channel ${channelId}:`, event);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  if (step === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">💬</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Nostr IM</h1>
            <p className="text-gray-600">Decentralized messaging</p>
            <p className="text-xs text-gray-500 mt-2">
              私钥可选：留空将自动生成，输入则使用您的私钥
            </p>
          </div>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter your name"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const name = (document.querySelector('input[placeholder="Enter your name"]') as HTMLInputElement)?.value;
                  const privateKey = (document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement)?.value;
                  if (name?.trim() && privateKey?.trim()) {
                    handleLogin(name.trim(), privateKey.trim());
                  }
                }
              }}
            />
            <input
              type="password"
              placeholder="Enter your private key (optional - will generate if empty)"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const name = (document.querySelector('input[placeholder="Enter your name"]') as HTMLInputElement)?.value;
                  const privateKey = (document.querySelector('input[placeholder="Enter your private key (optional - will generate if empty)"]') as HTMLInputElement)?.value;
                  if (name?.trim()) {
                    handleLogin(name.trim(), privateKey || '');
                  }
                }
              }}
            />
            <button
              onClick={() => {
                const name = (document.querySelector('input[placeholder="Enter your name"]') as HTMLInputElement)?.value;
                const privateKey = (document.querySelector('input[placeholder="Enter your private key (optional - will generate if empty)"]') as HTMLInputElement)?.value;
                if (name?.trim()) {
                  handleLogin(name.trim(), privateKey || '');
                }
              }}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-500 text-white py-3 px-6 rounded-xl font-semibold hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
            >
              Start Chatting
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">Nostr IM</h1>
          <p className="text-sm text-gray-600">Welcome, {user?.name}</p>
          <p className="text-xs text-gray-500 font-mono break-all">
            {user?.pubkey}
          </p>
          <div className="mt-2 p-2 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-700 font-semibold">当前渠道</p>
            <p className="text-xs text-blue-600 font-mono">{getChannelId()}</p>
          </div>
           <div className="flex items-center gap-2 mt-2">
             <div className="w-2 h-2 bg-green-500 rounded-full"></div>
             <span className="text-xs text-green-600">Connected to {wsConnections.length} relays</span>
           </div>
           <div className="mt-2 space-y-1">
             <button
               onClick={() => subscribeAllProfiles()}
               className="w-full px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
             >
               Subscribe Profiles
             </button>
             <button
               onClick={() => forceSubscribeAll()}
               className="w-full px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
             >
               Force Subscribe
             </button>
             <button
               onClick={() => {
                 if (user?.name && user?.pubkey && user?.privateKey) {
                   console.log(`📤 Manually sending profile event...`);
                   sendProfileEvent(user.name, user.pubkey, user.privateKey);
                 }
               }}
               className="w-full px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600"
             >
               Send Profile
             </button>
             <button
               onClick={() => {
                 if (user?.pubkey) {
                   console.log(`👤 Manually adding current user to subscription...`);
                   addUserToSubscription(user.pubkey);
                 }
               }}
               className="w-full px-3 py-1 bg-purple-500 text-white text-xs rounded hover:bg-purple-600"
             >
               Add User
             </button>
             <div className="text-xs text-gray-500">
               Users: {subscribedUsers.size}
             </div>
           </div>
        </div>
        
        <div className="flex-1 p-4">
          <div className="space-y-2">
            <div className="p-3 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-gray-900">Demo Chat</h3>
              <p className="text-sm text-gray-600">Your conversation</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-900 text-sm">Nostr Info</h4>
              <p className="text-xs text-gray-600">Messages are sent via Nostr protocol</p>
              <p className="text-xs text-gray-500 mt-1">
                {messages.length} message{messages.length !== 1 ? 's' : ''} sent
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-white border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">渠道聊天</h2>
          <p className="text-sm text-gray-600">与同网站用户聊天</p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">💬</span>
                </div>
                <h3 className="text-lg font-semibold mb-2">No messages yet</h3>
                <p>Start the conversation by sending your first message</p>
              </div>
            </div>
          ) : (
             messages.map((msg) => {
               const isOwnMessage = msg.sender === user?.pubkey;
               const senderProfile = userProfiles[msg.sender];
               const senderName = isOwnMessage ? user?.name : (senderProfile?.name || `User_${msg.sender.substring(0, 8)}`);
               
               return (
                <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-4 py-2 rounded-2xl max-w-xs ${
                    isOwnMessage 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-900'
                  }`}>
                    {!isOwnMessage && (
                      <p className="text-xs font-semibold mb-1 opacity-75">
                        {senderName}
                      </p>
                    )}
                    <p className="text-sm">{msg.text}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className={`text-xs ${
                        isOwnMessage ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {new Date(msg.time).toLocaleTimeString()}
                      </p>
                      <div className="flex items-center gap-1">
                        <span className="text-xs">✓</span>
                        <span className="text-xs">Nostr</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
             })
           )}
           <div ref={messagesEndRef} />
         </div>

        {/* Message Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;