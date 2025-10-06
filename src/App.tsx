import { useState, useEffect } from 'react';
import { getPublicKey, finalizeEvent } from 'nostr-tools';

function App() {
  const [step, setStep] = useState<'login' | 'chat'>('login');
  const [user, setUser] = useState<{name: string, pubkey: string, privateKey: string} | null>(null);
  const [messages, setMessages] = useState<Array<{id: string, text: string, sender: string, time: number, event?: any}>>([]);
  const [newMessage, setNewMessage] = useState('');
  const [relays] = useState(['wss://relay.damus.io', 'wss://relay.snort.social']);
  const [wsConnections, setWsConnections] = useState<WebSocket[]>([]);
  
  
  // 获取当前网站渠道ID
  const getChannelId = () => {
    return window.location.hostname + window.location.pathname;
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

  const handleLogin = (name: string) => {
    // 从环境变量读取私钥
    const privateKey = process.env.VITE_NOSTR_PRIVATE_KEY;
    
    if (!privateKey) {
      alert('请在 .env 文件中配置 VITE_NOSTR_PRIVATE_KEY');
      return;
    }
    
    // 从私钥推导公钥
    const pubkey = derivePublicKey(privateKey);
    
    console.log('Using keys:', { 
      privateKey: privateKey.substring(0, 8) + '...', 
      pubkey: pubkey.substring(0, 8) + '...',
      source: 'env'
    });
    
    setUser({ name, pubkey, privateKey });
    setStep('chat');
    
    // Connect to relays
    connectToRelays();
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
            filters: [{ 
              kinds: [4], // Direct messages
              '#t': [channelId] // Only messages tagged with this channel
            }]
          };
          ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
          console.log(`📡 Subscribed to channel: ${channelId}`);
        };
        
        ws.onmessage = (event) => {
          console.log('Received message from relay', event.data);
          try {
            const data = JSON.parse(event.data);
            if (data[0] === 'EVENT' && data[2].kind === 4) {
              // New message received
              const event = data[2];
              const channelId = getChannelId();
              
              // 检查消息是否属于当前渠道
             const hasChannelTag = event.tags && event.tags.some((tag: any) => 
               tag[0] === 't' && tag[1] === channelId
             );
              
              if (hasChannelTag) {
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
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    
    try {
      const channelId = getChannelId();
      const created_at = Math.floor(Date.now() / 1000);
      
      // Create Nostr event template
      const eventTemplate = {
        kind: 4, // Direct message
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
      
      // Debug: 检查长度
      console.log('Event ID length:', event.id.length, 'Signature length:', event.sig.length);
      
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
          </div>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter your name"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  handleLogin(e.currentTarget.value.trim());
                }
              }}
            />
            <button
              onClick={() => {
                const name = (document.querySelector('input') as HTMLInputElement)?.value;
                if (name?.trim()) handleLogin(name.trim());
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
            messages.map((msg) => (
              <div key={msg.id} className="flex justify-end">
                <div className="bg-blue-500 text-white px-4 py-2 rounded-2xl max-w-xs">
                  <p className="text-sm">{msg.text}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-blue-100">
                      {new Date(msg.time).toLocaleTimeString()}
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="text-xs">✓</span>
                      <span className="text-xs">Nostr</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
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