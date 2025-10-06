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
  
  // 全局用户信息存储，避免状态更新时机问题
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
  
  // 调试日志：跟踪subscribedUsers变化
  useEffect(() => {
    if (subscribedUsers.size > 0) {
      console.log("📊 subscribedUsers updated:", subscribedUsers.size, "users");
    }
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

    console.log("📡 Subscribing to profiles for", allUsers.length, "users");

    currentConnections.forEach((ws, index) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['REQ', sub.id, ...sub.filters]));
        console.log(`📡 Sent profile subscription to relay ${index}`);
      }
    });
  };

  // 订阅特定用户的 profile 事件
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

  // 添加用户到订阅列表并立即订阅
  const addUserToSubscription = (pubkey: string) => {
    if (subscribedUsers.has(pubkey)) {
      return;
    }

    console.log(`👤 Adding new user: ${pubkey.substring(0, 8)}...`);
    
    // 创建新的用户集合
    const newSet = new Set([...subscribedUsers, pubkey]);
    
    // 立即订阅所有用户（包括新用户），传递新的用户集合
    subscribeAllProfiles(newSet);
    
    // 然后更新状态
    setSubscribedUsers(newSet);
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

  const handleSignIn = (privateKeyInput: string) => {
    if (!privateKeyInput?.trim()) {
      // 使用更友好的提示方式
      const privateKeyInput = document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement;
      if (privateKeyInput) {
        privateKeyInput.focus();
        privateKeyInput.style.borderColor = '#ef4444';
        privateKeyInput.placeholder = '请输入您的私钥';
        setTimeout(() => {
          privateKeyInput.style.borderColor = '';
          privateKeyInput.placeholder = 'Enter your private key';
        }, 3000);
      }
      return;
    }
    
    const privateKey = privateKeyInput.trim();
    console.log('🔐 Sign In with private key:', privateKey.substring(0, 8) + '...');
    
    // 从私钥推导公钥
    const pubkey = derivePublicKey(privateKey);
    
    console.log('Using keys:', { 
      privateKey: privateKey.substring(0, 8) + '...', 
      pubkey: pubkey.substring(0, 8) + '...',
      source: 'user_input'
    });
    
    // 先设置用户信息，用户名暂时使用公钥前缀
    const userInfo = { name: `User_${pubkey.substring(0, 8)}`, pubkey, privateKey };
    setUser(userInfo);
    globalUser = userInfo; // 同时更新全局用户信息
    setStep('chat');
    
    // 添加自己到订阅列表
    addUserToSubscription(pubkey);
    
    // Connect to relays
    connectToRelays();
    
    // 订阅自己的 profile 事件来获取真实用户名
    setTimeout(() => {
      subscribeToUserProfile(pubkey);
    }, 1000);
  };

  const handleSignUp = (name: string) => {
    console.log('🔐 Sign Up - generating new key for:', name);
    
    // 生成新私钥
    const generatedKey = generateSecretKey();
    const privateKey = Array.from(generatedKey).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // 显示私钥保存提示
    const showPrivateKeyModal = () => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      modal.innerHTML = `
        <div class="bg-white rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
          <div class="text-center mb-4">
            <div class="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span class="text-2xl">🔑</span>
            </div>
            <h3 class="text-lg font-bold text-gray-900 mb-2">新私钥已生成</h3>
            <p class="text-sm text-gray-600">请务必保存好您的私钥！</p>
          </div>
          
          <div class="bg-gray-50 rounded-lg p-3 mb-4">
            <p class="text-xs text-gray-500 mb-1">您的私钥：</p>
            <p class="text-sm font-mono break-all text-gray-800">${privateKey}</p>
          </div>
          
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <p class="text-xs text-yellow-800">
              ⚠️ 私钥是您身份的唯一凭证，丢失后将无法恢复！
            </p>
          </div>
          
          <div class="flex gap-3">
            <button id="copyKey" class="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-blue-600 transition-colors">
              复制私钥
            </button>
            <button id="continueBtn" class="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-600 transition-colors">
              继续
            </button>
          </div>
          
          <button id="cancelBtn" class="w-full mt-2 text-gray-500 hover:text-gray-700 text-sm">
            取消注册
          </button>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // 复制私钥功能
      modal.querySelector('#copyKey')?.addEventListener('click', () => {
        navigator.clipboard.writeText(privateKey).then(() => {
          const btn = modal.querySelector('#copyKey') as HTMLButtonElement;
          btn.textContent = '已复制！';
          btn.className = 'flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-semibold transition-colors';
          setTimeout(() => {
            btn.textContent = '复制私钥';
            btn.className = 'flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-blue-600 transition-colors';
          }, 2000);
        });
      });
      
      // 继续按钮
      modal.querySelector('#continueBtn')?.addEventListener('click', () => {
        document.body.removeChild(modal);
        proceedWithSignUp();
      });
      
      // 取消按钮
      modal.querySelector('#cancelBtn')?.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      // 点击背景关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });
    };
    
    const proceedWithSignUp = () => {
      // 从私钥推导公钥
      const pubkey = derivePublicKey(privateKey);
      
      console.log('Using keys:', { 
        privateKey: privateKey.substring(0, 8) + '...', 
        pubkey: pubkey.substring(0, 8) + '...',
        source: 'generated'
      });
      
      const userInfo = { name, pubkey, privateKey };
      setUser(userInfo);
      globalUser = userInfo; // 同时更新全局用户信息
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
    
    // 显示私钥保存模态框
    showPrivateKeyModal();
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
          
          // 连接建立后，订阅所有已订阅用户的个人资料
          setTimeout(() => {
            if (subscribedUsers.size > 0) {
              subscribeAllProfiles();
            }
          }, 500);
          
          // 如果当前用户已登录，发送个人资料事件
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
                        globalUser = updatedUser; // 同时更新全局用户信息
                      }                      
                      console.log(`👤 Profile updated: ${profileName}`);
                    } catch (e) {
                      console.log('Failed to parse profile:', e);
                    }
                  } else if (event.kind === 1) {
                 // Text note received
                 const channelId = getChannelId();
                 
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
                       const newMessages = [...prev, message];
                       // 按时间排序（旧到新）
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
      
       setMessages(prev => {
         // 检查是否已存在相同ID的消息，避免重复
         const exists = prev.some(msg => msg.id === message.id);
         if (!exists) {
           const newMessages = [...prev, message];
           // 按时间排序（旧到新）
           return newMessages.sort((a, b) => a.time - b.time);
         } else {
           console.log('⚠️ Duplicate sent message detected, skipping:', message.id);
         }
         return prev;
       });
       setNewMessage('');
       
       // 确保发送者也被订阅个人资料
       addUserToSubscription(user.pubkey);
       
       console.log(`📤 Message sent: ${newMessage.substring(0, 30)}...`);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  if (step === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 flex items-center justify-center p-4 relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
          <div className="absolute top-40 left-1/2 transform -translate-x-1/2 w-60 h-60 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
        </div>
        
        <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-2xl p-8 w-full max-w-md border border-white/20">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <span className="text-3xl">⚡</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2">
              Nostr IM
            </h1>
            <p className="text-gray-600 text-lg">Decentralized messaging</p>
            <div className="mt-4 flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-500">Powered by Nostr Protocol</span>
            </div>
          </div>

          {/* 模式选择 */}
          <div className="flex mb-8 bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl p-1.5 shadow-inner">
            <button
              onClick={() => setLoginMode('signin')}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all duration-300 ${
                loginMode === 'signin'
                  ? 'bg-white text-indigo-600 shadow-lg transform scale-105'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span className="flex items-center justify-center space-x-2">
                <span>🔑</span>
                <span>Sign In</span>
              </span>
            </button>
            <button
              onClick={() => setLoginMode('signup')}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all duration-300 ${
                loginMode === 'signup'
                  ? 'bg-white text-indigo-600 shadow-lg transform scale-105'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              <span className="flex items-center justify-center space-x-2">
                <span>✨</span>
                <span>Sign Up</span>
              </span>
            </button>
          </div>

          {loginMode === 'signin' ? (
            // Sign In 表单
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center">
                  <span className="mr-2">🔐</span>
                  Private Key
                </label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="Enter your private key"
                    className="w-full px-4 py-4 border-2 border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all duration-300 bg-gray-50 focus:bg-white"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const privateKey = (document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement)?.value;
                        if (privateKey?.trim()) {
                          handleSignIn(privateKey.trim());
                        }
                      }
                    }}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <span className="text-gray-400">🔑</span>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="text-indigo-600 text-sm">ℹ️</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-indigo-800 mb-1">
                      Sign In with Private Key
                    </p>
                    <p className="text-sm text-indigo-700">
                      Your username will be loaded from your profile automatically.
                    </p>
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => {
                  const privateKey = (document.querySelector('input[placeholder="Enter your private key"]') as HTMLInputElement)?.value;
                  if (privateKey?.trim()) {
                    handleSignIn(privateKey.trim());
                  }
                }}
                className="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white py-4 px-6 rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 flex items-center justify-center space-x-2"
              >
                <span>🚀</span>
                <span>Sign In</span>
              </button>
            </div>
          ) : (
            // Sign Up 表单
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center">
                  <span className="mr-2">👤</span>
                  Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Choose a username"
                    className="w-full px-4 py-4 border-2 border-gray-200 rounded-2xl focus:ring-4 focus:ring-green-100 focus:border-green-400 transition-all duration-300 bg-gray-50 focus:bg-white"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const name = (document.querySelector('input[placeholder="Choose a username"]') as HTMLInputElement)?.value;
                        if (name?.trim()) {
                          handleSignUp(name.trim());
                        }
                      }
                    }}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <span className="text-gray-400">✨</span>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-100">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <span className="text-green-600 text-sm">🆕</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-800 mb-1">
                      New to Nostr?
                    </p>
                    <p className="text-sm text-green-700">
                      We'll generate a new private key for you. Make sure to save it securely!
                    </p>
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => {
                  const name = (document.querySelector('input[placeholder="Choose a username"]') as HTMLInputElement)?.value;
                  if (name?.trim()) {
                    handleSignUp(name.trim());
                  }
                }}
                className="w-full bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 text-white py-4 px-6 rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 flex items-center justify-center space-x-2"
              >
                <span>✨</span>
                <span>Create Account</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex">
      {/* Sidebar */}
      <div className="w-80 bg-white/80 backdrop-blur-sm border-r border-white/20 flex flex-col shadow-xl">
        <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Nostr IM</h1>
              <p className="text-indigo-100 text-sm">Decentralized Chat</p>
            </div>
          </div>
          
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-sm">👤</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{user?.name}</p>
                <p className="text-indigo-200 text-xs truncate">
                  {user?.pubkey?.substring(0, 16)}...
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="bg-white/10 rounded-lg p-2">
                <p className="text-xs text-indigo-200 font-semibold mb-1">Current Channel</p>
                <p className="text-xs text-white font-mono break-all">{getChannelId()}</p>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-indigo-200">
                  Connected to {wsConnections.length} relays
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex-1 p-6">
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-100">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 text-sm">💬</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Demo Chat</h3>
                  <p className="text-sm text-gray-600">Your conversation</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-2xl border border-gray-100">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <span className="text-gray-600 text-sm">⚡</span>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Nostr Protocol</h4>
                  <p className="text-xs text-gray-600">Decentralized messaging</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Messages</span>
                  <span className="text-xs font-semibold text-gray-700">
                    {messages.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Status</span>
                  <span className="text-xs font-semibold text-green-600 flex items-center">
                    <div className="w-2 h-2 bg-green-400 rounded-full mr-1"></div>
                    Online
                  </span>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl border border-purple-100">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <span className="text-purple-600 text-sm">🔒</span>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Privacy</h4>
                  <p className="text-xs text-gray-600">End-to-end encrypted</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-white/20 p-6 shadow-sm">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white text-xl">💬</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Channel Chat</h2>
              <p className="text-sm text-gray-600">Connect with users on the same website</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-transparent to-gray-50/30">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                  <span className="text-4xl">💬</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-800 mb-3">Welcome to Nostr IM</h3>
                <p className="text-gray-600 mb-6">Start the conversation by sending your first message</p>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                  <span>🔒</span>
                  <span>End-to-end encrypted</span>
                  <span>•</span>
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
               const shortPubkey = msg.sender.substring(0, 8) + '...';
               
               return (
                 <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group`}>
                   <div className={`max-w-md px-5 py-3 rounded-3xl shadow-lg transition-all duration-200 hover:shadow-xl ${
                     isOwnMessage 
                       ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-br-lg' 
                       : 'bg-white text-gray-900 border border-gray-100 rounded-bl-lg'
                   }`}>
                     {!isOwnMessage && (
                       <div className="mb-2 flex items-center space-x-2">
                         <div className="w-6 h-6 bg-gradient-to-r from-gray-400 to-gray-500 rounded-full flex items-center justify-center">
                           <span className="text-white text-xs font-bold">
                             {senderName.charAt(0).toUpperCase()}
                           </span>
                         </div>
                         <div>
                           <p className="text-xs font-semibold text-gray-700">
                             {senderName}
                           </p>
                           <p className="text-xs text-gray-500 font-mono">
                             {shortPubkey}
                           </p>
                         </div>
                       </div>
                     )}
                     <p className="text-sm leading-relaxed">{msg.text}</p>
                     <div className="flex items-center justify-between mt-2">
                       <p className={`text-xs ${
                         isOwnMessage ? 'text-indigo-100' : 'text-gray-500'
                       }`}>
                         {new Date(msg.time).toLocaleTimeString()}
                       </p>
                       <div className="flex items-center gap-1">
                         <span className={`text-xs ${isOwnMessage ? 'text-indigo-200' : 'text-gray-400'}`}>✓</span>
                         <span className={`text-xs ${isOwnMessage ? 'text-indigo-200' : 'text-gray-400'}`}>Nostr</span>
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
        <div className="bg-white/80 backdrop-blur-sm border-t border-white/20 p-6 shadow-lg">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="w-full px-6 py-4 border-2 border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all duration-300 bg-gray-50 focus:bg-white text-gray-900 placeholder-gray-500"
              />
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                <span className="text-gray-400">💬</span>
              </div>
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-8 py-4 rounded-2xl font-bold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex items-center space-x-2"
            >
              <span>🚀</span>
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;