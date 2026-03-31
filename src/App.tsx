/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  CheckSquare, 
  Gift, 
  Plus, 
  Bell, 
  ChevronRight, 
  Camera, 
  Check, 
  X, 
  Star, 
  Trophy,
  ArrowLeft,
  Image as ImageIcon,
  Clock,
  User,
  Moon,
  Sun,
  Copy,
  Loader2,
  LogOut
} from 'lucide-react';

import { GoogleGenAI } from "@google/genai";
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  signInAnonymously,
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';

// --- Types ---

type TaskStatus = 'TO DO' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DONE';

interface Task {
  id: string;
  title: string;
  description: string;
  points: number;
  status: TaskStatus;
  assignedToId: string;
  assignedToName: string;
  category: string;
  submittedAt?: string;
  proofImage?: string;
  aiRating?: number;
  aiFeedback?: string;
}

interface FamilyMember {
  id: string;
  name: string;
  points: number;
  avatar: string;
  role?: 'parent' | 'child';
}

interface Family {
  id?: string;
  name: string;
  code: string;
  isLocked?: boolean;
}

interface JoinRequest {
  id: string;
  uid: string;
  name: string;
  avatar: string;
  role: 'parent' | 'child';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt?: any;
}

interface Reward {
  id: string;
  title: string;
  description: string;
  cost: number;
  image: string;
}

// --- Mock Data ---

const INITIAL_TASKS: Task[] = [];

const REWARDS: Reward[] = [
  {
    id: 'r1',
    title: 'Extra Screen Time',
    description: 'Redeem for 30 minutes of gaming or YouTube time tonight.',
    cost: 50,
    image: 'https://picsum.photos/seed/gaming/400/250'
  },
  {
    id: 'r2',
    title: 'Pizza Night',
    description: 'Choose the toppings for the whole family this Friday!',
    cost: 200,
    image: 'https://picsum.photos/seed/pizza/400/250'
  },
  {
    id: 'r3',
    title: 'Late Bedtime Pass',
    description: 'Stay up 1 hour past your usual bedtime for reading or play.',
    cost: 100,
    image: 'https://picsum.photos/seed/bedtime/400/250'
  }
];

// --- Components ---

const ProgressBar = ({ progress, color = "bg-indigo-500" }: { progress: number, color?: string }) => (
  <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
    <motion.div 
      initial={{ width: 0 }}
      animate={{ width: `${Math.min(100, progress)}%` }}
      className={`${color} h-full rounded-full`}
    />
  </div>
);

const Badge = ({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'success' | 'warning' | 'pending' }) => {
  const styles = {
    default: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
    success: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    warning: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
    pending: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles[variant]}`}>
      {children}
    </span>
  );
};

const Logo = ({ darkMode, familyName }: { darkMode: boolean, familyName?: string }) => (
  <div className="flex items-center gap-2">
    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20">
      <Trophy className="w-5 h-5 text-white" />
    </div>
    <div className="flex flex-col -space-y-1">
      <span className="text-lg font-black tracking-tight bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]">HouseQuest</span>
      {familyName && <span className="text-[8px] font-bold text-indigo-400 uppercase tracking-widest">{familyName}</span>}
    </div>
  </div>
);

const Onboarding = ({ 
  onComplete, 
  darkMode 
}: { 
  onComplete: (family: Family, role: 'parent' | 'child', familyId: string) => void,
  darkMode: boolean 
}) => {
  const [step, setStep] = useState<'login' | 'start' | 'create' | 'join' | 'role' | 'find' | 'waiting'>('login');
  const [lastUser, setLastUser] = useState<{ name: string, avatar: string, email: string } | null>(null);
  const [publicFamilies, setPublicFamilies] = useState<(Family & { id: string })[]>([]);
  const [pendingRequest, setPendingRequest] = useState<JoinRequest | null>(null);
  const [requestFamilyId, setRequestFamilyId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('lastUser');
    if (saved) {
      try {
        setLastUser(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse lastUser", e);
      }
    }
  }, []);
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [tempFamily, setTempFamily] = useState<Family | null>(null);
  const [tempFamilyId, setTempFamilyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const generateCode = () => {
    return 'FH' + Math.floor(1000 + Math.random() * 9000);
  };

  const handleLogin = async () => {
    setIsProcessing(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const familyDoc = await getDoc(doc(db, 'families', data.familyId));
        if (familyDoc.exists()) {
          onComplete(familyDoc.data() as Family, data.role, data.familyId);
          return;
        }
      }
      setStep('start');
    } catch (err) {
      console.error("Login failed:", err);
      setError("Login failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnonymousLogin = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await signInAnonymously(auth);
      // Anonymous users are always new unless they have a session, 
      // but we check just in case.
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const familyDoc = await getDoc(doc(db, 'families', data.familyId));
        if (familyDoc.exists()) {
          onComplete(familyDoc.data() as Family, data.role, data.familyId);
          return;
        }
      }
      setStep('start');
    } catch (err: any) {
      console.error("Anonymous login failed:", err);
      if (err.code === 'auth/admin-restricted-operation') {
        setError("Anonymous sign-in is disabled in Firebase Console. Please enable it under Authentication > Sign-in method. Visit: https://console.firebase.google.com/project/gen-lang-client-0892382210/authentication/providers");
      } else {
        setError("Anonymous login failed. Please ensure Anonymous Auth is enabled in Firebase Console.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreate = async () => {
    if (!familyName.trim()) return;
    setIsProcessing(true);
    try {
      const code = generateCode();
      const familyRef = doc(collection(db, 'families'));
      const familyData = { name: familyName, code, createdAt: serverTimestamp() };
      await setDoc(familyRef, familyData);
      
      // Add to invite codes lookup
      await setDoc(doc(db, 'inviteCodes', code), { familyId: familyRef.id });
      
      setTempFamily(familyData as any);
      setTempFamilyId(familyRef.id);
      setStep('role');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'families');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoin = async () => {
    if (inviteCode.startsWith('FH') && inviteCode.length === 6) {
      setIsProcessing(true);
      try {
        const inviteDoc = await getDoc(doc(db, 'inviteCodes', inviteCode));
        if (inviteDoc.exists()) {
          const familyId = inviteDoc.data().familyId;
          const familyDoc = await getDoc(doc(db, 'families', familyId));
          if (familyDoc.exists()) {
            setTempFamily(familyDoc.data() as Family);
            setTempFamilyId(familyId);
            setStep('role');
            setError(null);
          } else {
            setError("Family not found.");
          }
        } else {
          setError("Invalid code! Try something like FH1234");
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `inviteCodes/${inviteCode}`);
      } finally {
        setIsProcessing(false);
      }
    } else {
      setError("Invalid code! Try something like FH1234");
    }
  };

  const handleFindFamilies = async () => {
    setIsProcessing(true);
    try {
      const q = query(collection(db, 'families'), where('isLocked', '!=', true));
      const snapshot = await getDocs(q);
      const families = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Family & { id: string }));
      setPublicFamilies(families);
      setStep('find');
    } catch (err) {
      console.error("Failed to find families:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRequestJoin = async (familyId: string, role: 'parent' | 'child') => {
    if (!auth.currentUser) return;
    setIsProcessing(true);
    try {
      const requestData = {
        uid: auth.currentUser.uid,
        name: auth.currentUser.displayName || (role === 'parent' ? 'Commander' : 'Hero'),
        avatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${auth.currentUser.uid}`,
        role,
        status: 'PENDING',
        createdAt: serverTimestamp()
      };
      const requestRef = doc(db, 'families', familyId, 'joinRequests', auth.currentUser.uid);
      await setDoc(requestRef, requestData);
      setPendingRequest({ id: auth.currentUser.uid, ...requestData } as any);
      setRequestFamilyId(familyId);
      setStep('waiting');

      // Listen for status changes
      const unsubscribe = onSnapshot(requestRef, async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as JoinRequest;
          if (data.status === 'ACCEPTED') {
            unsubscribe();
            // Wait a bit for the parent to finish creating the user profile
            setTimeout(async () => {
              const familyDoc = await getDoc(doc(db, 'families', familyId));
              if (familyDoc.exists()) {
                onComplete(familyDoc.data() as Family, data.role, familyId);
              }
            }, 2000);
          } else if (data.status === 'DECLINED') {
            unsubscribe();
            setError("Your request was declined.");
            setStep('find');
          }
        }
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'joinRequests');
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (auth.currentUser && step === 'login') {
      // Check if user already has a pending request in any family
      // This is tricky because we don't know which family. 
      // For now, we'll assume they stay on the waiting screen if they just requested.
    }
  }, [auth.currentUser]);
  const handleRoleSelect = async (role: 'parent' | 'child') => {
    if (tempFamily && tempFamilyId && auth.currentUser) {
      setIsProcessing(true);
      try {
        // Create user profile
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          familyId: tempFamilyId,
          role,
          email: auth.currentUser.email
        });

        // Add as family member
        const memberRef = doc(collection(db, 'families', tempFamilyId, 'members'), auth.currentUser.uid);
        await setDoc(memberRef, {
          name: auth.currentUser.displayName || (role === 'parent' ? 'Commander' : 'Hero'),
          points: 0,
          avatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${auth.currentUser.uid}`,
          role,
          uid: auth.currentUser.uid
        });

        onComplete(tempFamily, role, tempFamilyId);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'users/members');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-[#F9F9FF] text-slate-900'} font-sans max-w-md mx-auto shadow-2xl relative overflow-hidden flex flex-col transition-colors duration-300 p-8 justify-center`}>
      <AnimatePresence mode="wait">
        {step === 'login' && (
          <motion.div 
            key="login"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="space-y-8 text-center"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-24 h-24 bg-indigo-600 rounded-[32px] flex items-center justify-center shadow-2xl shadow-indigo-500/20">
                <Trophy className="w-12 h-12 text-white" />
              </div>
              <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]">HouseQuest</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium">Sync your family quests across all devices.</p>
            </div>
            <div className="space-y-4">
              <button 
                onClick={handleLogin}
                disabled={isProcessing}
                className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-5 rounded-[24px] font-bold border-2 border-slate-100 dark:border-slate-800 shadow-xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-all active:scale-95"
              >
                {isProcessing ? <Loader2 className="w-6 h-6 animate-spin text-indigo-500" /> : (
                  <>
                    <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
                    Continue with Google
                  </>
                )}
              </button>

              {lastUser && (
                <button 
                  onClick={handleLogin}
                  disabled={isProcessing}
                  className="w-full bg-indigo-600 text-white py-5 rounded-[24px] font-bold shadow-xl flex items-center justify-center gap-3 hover:bg-indigo-700 transition-all active:scale-95"
                >
                  <img src={lastUser.avatar} className="w-6 h-6 rounded-full border border-white/20" alt="Last user" />
                  Continue as {lastUser.name}
                </button>
              )}

              <button 
                onClick={handleAnonymousLogin}
                disabled={isProcessing}
                className="w-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 py-4 rounded-[24px] font-bold border-2 border-transparent hover:border-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <>
                    <User className="w-5 h-5" />
                    Continue without account
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'start' && (
          <motion.div 
            key="start"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8 text-center"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 bg-indigo-600 rounded-[24px] flex items-center justify-center shadow-2xl shadow-indigo-500/20">
                <Trophy className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 bg-clip-text text-transparent animate-gradient-x bg-[length:200%_auto]">HouseQuest</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium">Gamify your household chores and turn every day into an adventure!</p>
            </div>

            <div className="space-y-4">
              <button 
                onClick={() => setStep('create')}
                className="w-full bg-indigo-500 text-white py-5 rounded-[24px] font-bold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 hover:bg-indigo-600 transition-all active:scale-95"
              >
                Create Family
              </button>
              <button 
                onClick={() => setStep('join')}
                className="w-full bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 py-5 rounded-[24px] font-bold border-2 border-indigo-50 dark:border-slate-800 hover:border-indigo-100 dark:hover:border-indigo-700 transition-all active:scale-95"
              >
                Join Family
              </button>
            </div>
          </motion.div>
        )}

        {step === 'create' && (
          <motion.div 
            key="create"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <button onClick={() => setStep('start')} className="text-slate-400 hover:text-indigo-500 flex items-center gap-2 font-bold text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-indigo-900 dark:text-white">Start Your Dynasty</h2>
              <p className="text-slate-500 dark:text-slate-400">Give your family a name to begin the quest.</p>
            </div>
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Family Name (e.g. The Skywalkers)" 
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-[24px] px-6 py-5 focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white outline-none"
              />
              <button 
                disabled={!familyName.trim() || isProcessing}
                onClick={handleCreate}
                className="w-full bg-indigo-500 disabled:opacity-50 text-white py-5 rounded-[24px] font-bold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 hover:bg-indigo-600 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'join' && (
          <motion.div 
            key="join"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <button onClick={() => setStep('start')} className="text-slate-400 hover:text-indigo-500 flex items-center gap-2 font-bold text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-indigo-900 dark:text-white">Enter Invite Code</h2>
              <p className="text-slate-500 dark:text-slate-400">Ask your family commander for the FHxxxx code.</p>
            </div>
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Invite Code (e.g. FH1234)" 
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value.toUpperCase());
                  if (error) setError(null);
                }}
                maxLength={6}
                className={`w-full bg-white dark:bg-slate-900 border-2 ${error ? 'border-rose-500' : 'border-slate-100 dark:border-slate-800'} rounded-[24px] px-6 py-5 focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white outline-none text-center text-2xl font-black tracking-widest`}
              />
              {error && (
                <motion.p 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-rose-500 text-xs font-bold text-center"
                >
                  {error}
                </motion.p>
              )}
              <button 
                disabled={inviteCode.length < 6 || isProcessing}
                onClick={handleJoin}
                className="w-full bg-indigo-500 disabled:opacity-50 text-white py-5 rounded-[24px] font-bold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 hover:bg-indigo-600 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Join Quest'}
              </button>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100 dark:border-slate-800"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#F9F9FF] dark:bg-slate-950 px-2 text-slate-400 font-bold">Or</span>
                </div>
              </div>

              <button 
                onClick={handleFindFamilies}
                disabled={isProcessing}
                className="w-full bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 py-4 rounded-[24px] font-bold border-2 border-indigo-50 dark:border-slate-800 hover:border-indigo-100 dark:hover:border-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Find Your Family
              </button>
            </div>
          </motion.div>
        )}

        {step === 'find' && (
          <motion.div 
            key="find"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <button onClick={() => setStep('join')} className="text-slate-400 hover:text-indigo-500 flex items-center gap-2 font-bold text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-indigo-900 dark:text-white">Public Families</h2>
              <p className="text-slate-500 dark:text-slate-400">Select a family to request joining.</p>
            </div>
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 no-scrollbar">
              {publicFamilies.length === 0 ? (
                <p className="text-center py-8 text-slate-400 font-medium">No public families found.</p>
              ) : (
                publicFamilies.map(f => (
                  <div key={f.id} className="bg-white dark:bg-slate-900 p-4 rounded-[24px] border-2 border-slate-50 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <h4 className="font-black text-indigo-900 dark:text-white">{f.name}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Public Quest</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleRequestJoin(f.id, 'child')}
                        className="bg-yellow-400 text-white px-3 py-2 rounded-xl text-[10px] font-black hover:bg-yellow-500 transition-colors"
                      >
                        Join as Hero
                      </button>
                      <button 
                        onClick={() => handleRequestJoin(f.id, 'parent')}
                        className="bg-indigo-500 text-white px-3 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-600 transition-colors"
                      >
                        Join as Cmdr
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {step === 'waiting' && (
          <motion.div 
            key="waiting"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-8 text-center"
          >
            <div className="w-24 h-24 bg-yellow-400 rounded-[32px] flex items-center justify-center shadow-2xl shadow-yellow-500/20 mx-auto">
              <Clock className="w-12 h-12 text-white animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-indigo-900 dark:text-white">Request Sent!</h2>
              <p className="text-slate-500 dark:text-slate-400">Waiting for the family commander to approve your request.</p>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 rounded-[32px] border-2 border-slate-50 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Status</p>
              <Badge variant="pending">Pending Approval</Badge>
            </div>
            <button 
              onClick={() => setStep('start')}
              className="text-indigo-500 font-bold text-sm hover:underline"
            >
              Cancel Request
            </button>
          </motion.div>
        )}

        {step === 'role' && (
          <motion.div 
            key="role"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-2 text-center">
              <h2 className="text-3xl font-black text-indigo-900 dark:text-white">Choose Your Role</h2>
              <p className="text-slate-500 dark:text-slate-400">Are you the Commander or the Hero?</p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => handleRoleSelect('parent')}
                className="group relative bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 p-8 rounded-[32px] text-left hover:border-indigo-500 transition-all active:scale-95"
              >
                <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-500 mb-4 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                  <User className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-indigo-900 dark:text-white">Parent / Commander</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Assign quests, approve proofs, and complete your own hero missions.</p>
              </button>
              <button 
                onClick={() => handleRoleSelect('child')}
                className="group relative bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 p-8 rounded-[32px] text-left hover:border-indigo-500 transition-all active:scale-95"
              >
                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-2xl flex items-center justify-center text-yellow-500 mb-4 group-hover:bg-yellow-500 group-hover:text-white transition-colors">
                  <Star className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-indigo-900 dark:text-white">Child / Hero</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Complete missions, earn stars, and unlock epic rewards.</p>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [userRole, setUserRole] = useState<'parent' | 'child' | null>(null);
  const [view, setView] = useState<'parent' | 'child' | 'rewards'>('parent');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true';
    }
    return false;
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showManageFamily, setShowManageFamily] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [editingAvatarMemberId, setEditingAvatarMemberId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ title: '', assignedToName: '', assignedToId: '', points: 25, category: 'General' });
  const [notification, setNotification] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<{ id: string, text: string, time: string, type: 'info' | 'success' | 'warning' }[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            localStorage.setItem('lastUser', JSON.stringify({
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || (data.role === 'parent' ? 'Commander' : 'Hero'),
              avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
              email: firebaseUser.email
            }));
            setFamilyId(data.familyId);
            setUserRole(data.role);
            setView(data.role === 'child' ? 'child' : 'parent');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setFamilyId(null);
        setFamily(null);
        setUserRole(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!familyId) return;

    const unsubFamily = onSnapshot(doc(db, 'families', familyId), (snapshot) => {
      if (snapshot.exists()) setFamily(snapshot.data() as Family);
    }, (err) => handleFirestoreError(err, OperationType.GET, `families/${familyId}`));

    const unsubMembers = onSnapshot(collection(db, 'families', familyId, 'members'), (snapshot) => {
      const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FamilyMember));
      setFamilyMembers(members);
      if (members.length > 0 && !activeChildId) {
        // Try to find a child first, otherwise default to current user if they are a member
        const firstChild = members.find(m => m.role === 'child');
        if (firstChild) {
          setActiveChildId(firstChild.id);
        } else {
          const me = members.find(m => m.id === auth.currentUser?.uid);
          if (me) setActiveChildId(me.id);
        }
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `families/${familyId}/members`));

    const unsubTasks = onSnapshot(collection(db, 'families', familyId, 'tasks'), (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(taskList.sort((a, b) => b.id.localeCompare(a.id)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `families/${familyId}/tasks`));

    return () => {
      unsubFamily();
      unsubMembers();
      unsubTasks();
    };
  }, [familyId]);

  const activeChild = familyMembers.find(m => m.id === activeChildId) || 
                      familyMembers.find(m => m.id === auth.currentUser?.uid) || 
                      familyMembers.find(m => m.role === 'child') || 
                      null;

  const [selectedChildTask, setSelectedChildTask] = useState<Task | null>(null);

  const addNotification = (text: string, type: 'info' | 'success' | 'warning' = 'info') => {
    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 10));
    setNotification(text);
  };

  // Persist dark mode
  useEffect(() => {
    localStorage.setItem('darkMode', String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleApprove = async (taskId: string) => {
    if (!familyId) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), { status: 'APPROVED' });
      const memberRef = doc(db, 'families', familyId, 'members', task.assignedToId);
      const member = familyMembers.find(m => m.id === task.assignedToId);
      if (member) {
        await updateDoc(memberRef, { points: member.points + task.points });
      }
      addNotification(`Task "${task.title}" approved! +${task.points} pts awarded.`, 'success');
      setSelectedTask(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const handleReject = async (taskId: string) => {
    if (!familyId) return;
    const task = tasks.find(t => t.id === taskId);
    try {
      await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), { status: 'REJECTED' });
      addNotification(`Task "${task?.title}" rejected. Try again!`, 'warning');
      setSelectedTask(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const analyzeProof = async (taskId: string, base64Image: string) => {
    if (!familyId) return;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is missing. Skipping AI analysis.");
      return;
    }
    
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const task = tasks.find(t => t.id === taskId);
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: `You are a helpful family assistant. Review this photo proof for the task: "${task?.title}". 
            Rate the completion quality from 1 to 5 (where 5 is perfect). 
            Provide a short, encouraging feedback message for a child.
            Return ONLY a JSON object with "rating" (number) and "feedback" (string).` },
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } }
          ]
        },
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || "{}");
      await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), {
        aiRating: result.rating || 0,
        aiFeedback: result.feedback || "AI couldn't analyze the image clearly."
      });
    } catch (error) {
      console.error("AI Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUploadProof = async (taskId: string, imageFile: File) => {
    if (!familyId) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), {
          status: 'PENDING',
          submittedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          proofImage: base64String
        });
        
        analyzeProof(taskId, base64String);
        addNotification(`Proof uploaded for "${tasks.find(t => t.id === taskId)?.title}"! AI is reviewing...`);
        setSelectedChildTask(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
      }
    };
    reader.readAsDataURL(imageFile);
  };

  const handleAddMember = async (name: string) => {
    if (!name.trim() || !familyId) return;
    try {
      await addDoc(collection(db, 'families', familyId, 'members'), {
        name,
        points: 0,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
        role: 'child'
      });
      addNotification(`${name} joined the family!`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'members');
    }
  };

  const handleRemoveMember = async (id: string) => {
    if (!familyId) return;
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;
    
    try {
      await deleteDoc(doc(db, 'families', familyId, 'members', id));
      // Also cleanup tasks assigned to them
      const assignedTasks = tasks.filter(t => t.assignedToId === id);
      for (const t of assignedTasks) {
        await deleteDoc(doc(db, 'families', familyId, 'tasks', t.id));
      }
      addNotification(`${member.name} removed from family.`, 'warning');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `members/${id}`);
    }
  };

  const handleRenameMember = async (id: string, newName: string) => {
    if (!newName.trim() || !familyId) return;
    try {
      await updateDoc(doc(db, 'families', familyId, 'members', id), { name: newName });
      addNotification(`Renamed to ${newName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `members/${id}`);
    }
  };

  const handleUpdateAvatar = async (id: string, newAvatar: string) => {
    if (!familyId) return;
    try {
      await updateDoc(doc(db, 'families', familyId, 'members', id), { avatar: newAvatar });
      setEditingAvatarMemberId(null);
      addNotification("Profile picture updated!", "success");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `members/${id}`);
    }
  };

  const handleOnboardingComplete = (newFamily: Family, role: 'parent' | 'child', newFamilyId: string) => {
    if (auth.currentUser) {
      localStorage.setItem('lastUser', JSON.stringify({
        uid: auth.currentUser.uid,
        name: auth.currentUser.displayName || (role === 'parent' ? 'Commander' : 'Hero'),
        avatar: auth.currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${auth.currentUser.uid}`,
        email: auth.currentUser.email
      }));
    }
    setFamily(newFamily);
    setUserRole(role);
    setFamilyId(newFamilyId);
    setView(role === 'child' ? 'child' : 'parent');
  };

  const handleLeaveFamily = async () => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
      if (familyId) {
        await deleteDoc(doc(db, 'families', familyId, 'members', user.uid));
      }
      setFamily(null);
      setUserRole(null);
      setFamilyId(null);
      setShowLeaveConfirm(false);
      setShowManageFamily(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'users/members');
    }
  };

  const handleAddTask = async () => {
    if (!newTask.title || !newTask.assignedToId || !familyId) return;
    try {
      await addDoc(collection(db, 'families', familyId, 'tasks'), {
        ...newTask,
        description: '',
        status: 'TO DO',
        createdAt: serverTimestamp()
      });
      setShowAddTask(false);
      setNewTask({ title: '', assignedToName: '', assignedToId: '', points: 25, category: 'General' });
      addNotification('Quest assigned successfully!', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
    }
  };

  const handleClaimReward = async (rewardId: string) => {
    if (!familyId || !activeChildId) return;
    const reward = REWARDS.find(r => r.id === rewardId);
    const member = familyMembers.find(m => m.id === activeChildId);
    
    if (!reward || !member || member.points < reward.cost) return;

    try {
      const memberRef = doc(db, 'families', familyId, 'members', activeChildId);
      await updateDoc(memberRef, { points: member.points - reward.cost });
      
      // Log the reward claim in a subcollection or just notify
      await addDoc(collection(db, 'families', familyId, 'activity'), {
        type: 'REWARD_CLAIMED',
        memberId: activeChildId,
        memberName: member.name,
        rewardTitle: reward.title,
        cost: reward.cost,
        timestamp: serverTimestamp()
      });

      addNotification(`Reward "${reward.title}" unlocked! Enjoy!`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `members/${activeChildId}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!familyId) return;
    try {
      await deleteDoc(doc(db, 'families', familyId, 'tasks', taskId));
      addNotification('Quest deleted.', 'warning');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const handleEditTask = async (taskId: string, updates: Partial<Task>) => {
    if (!familyId) return;
    try {
      await updateDoc(doc(db, 'families', familyId, 'tasks', taskId), updates);
      addNotification('Quest updated!', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  useEffect(() => {
    if (familyId && userRole === 'parent') {
      const q = query(collection(db, 'families', familyId, 'joinRequests'), where('status', '==', 'PENDING'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JoinRequest));
        setJoinRequests(requests);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `families/${familyId}/joinRequests`);
      });
      return () => unsubscribe();
    }
  }, [familyId, userRole]);

  useEffect(() => {
    if (familyId) {
      const unsubscribe = onSnapshot(doc(db, 'families', familyId), (doc) => {
        if (doc.exists()) {
          setIsLocked(doc.data().isLocked || false);
        }
      });
      return () => unsubscribe();
    }
  }, [familyId]);

  const handleAcceptRequest = async (request: JoinRequest) => {
    if (!familyId) return;
    try {
      // 1. Create user profile
      await setDoc(doc(db, 'users', request.uid), {
        familyId,
        role: request.role,
        email: '' // We don't have it here, but it's okay for now
      });

      // 2. Add as family member
      const memberRef = doc(collection(db, 'families', familyId, 'members'), request.uid);
      await setDoc(memberRef, {
        name: request.name,
        points: 0,
        avatar: request.avatar,
        role: request.role,
        uid: request.uid
      });

      // 3. Update request status
      await updateDoc(doc(db, 'families', familyId, 'joinRequests', request.id), {
        status: 'ACCEPTED'
      });

      addNotification(`${request.name} joined the family!`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'joinRequests/accept');
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    if (!familyId) return;
    try {
      await updateDoc(doc(db, 'families', familyId, 'joinRequests', requestId), {
        status: 'DECLINED'
      });
      addNotification('Request declined.', 'warning');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'joinRequests/decline');
    }
  };

  const toggleFamilyLock = async () => {
    if (!familyId) return;
    try {
      await updateDoc(doc(db, 'families', familyId), {
        isLocked: !isLocked
      });
      addNotification(isLocked ? 'Family unlocked!' : 'Family locked!', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `families/${familyId}`);
    }
  };
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const pendingCount = tasks.filter(t => t.status === 'PENDING').length;

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!family || !userRole) {
    return <Onboarding onComplete={handleOnboardingComplete} darkMode={darkMode} />;
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-[#F9F9FF] text-slate-900'} font-sans max-w-md mx-auto shadow-2xl relative overflow-hidden flex flex-col transition-colors duration-300`}>
      
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-50 px-4 pointer-events-none"
          >
            <div className="bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center justify-center gap-2 max-w-xs mx-auto">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              {notification}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="px-4 pt-6 pb-2 flex items-center justify-between relative">
        <Logo darkMode={darkMode} familyName={family.name} />
        <div className="flex items-center gap-3">
          <button 
            onClick={handleLogout}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none shadow-sm ${
              darkMode 
                ? 'bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/60' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none shadow-sm ${
              darkMode 
                ? 'bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/60' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
            aria-label="Toggle Night Mode"
          >
            <motion.div
              initial={false}
              animate={{ rotate: darkMode ? 360 : 0 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              {darkMode ? <Moon className="w-5 h-5 fill-indigo-300" /> : <Sun className="w-5 h-5" />}
            </motion.div>
          </button>
          {view === 'parent' && (
            <button 
              onClick={() => setShowManageFamily(true)}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm transition-all ${darkMode ? 'bg-slate-800 text-indigo-400' : 'bg-white text-indigo-500'}`}
            >
              <User className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm transition-all relative ${darkMode ? 'bg-slate-800 text-indigo-400' : 'bg-white text-indigo-500'}`}
          >
            <Bell className="w-5 h-5" />
            {(pendingCount > 0 || isAnalyzing || notifications.length > 0) && (
              <span className={`absolute top-2 right-2 w-2.5 h-2.5 ${isAnalyzing ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'} border-2 ${darkMode ? 'border-slate-800' : 'border-white'} rounded-full`} />
            )}
          </button>
        </div>

        {/* Notifications Dropdown */}
        <AnimatePresence>
          {showNotifications && (
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={`absolute top-20 right-6 w-72 rounded-3xl shadow-2xl z-50 border overflow-hidden ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}
            >
              <div className={`p-4 border-bottom flex items-center justify-between ${darkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-indigo-50/50 border-slate-50'}`}>
                <h4 className={`font-bold text-sm ${darkMode ? 'text-indigo-300' : 'text-indigo-900'}`}>Activity Feed</h4>
                <button onClick={() => setNotifications([])} className={`text-[10px] font-bold uppercase ${darkMode ? 'text-indigo-500' : 'text-indigo-400'}`}>Clear</button>
              </div>
              <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                {notifications.length > 0 ? (
                  notifications.map(n => (
                    <div key={n.id} className={`p-3 rounded-2xl transition-colors flex gap-3 items-start ${darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}>
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.type === 'success' ? 'bg-green-500' : n.type === 'warning' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                      <div className="flex-1">
                        <p className={`text-xs leading-tight ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{n.text}</p>
                        <p className="text-[9px] text-slate-400 mt-1 font-medium">{n.time}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-slate-300">
                    <p className="text-xs font-bold uppercase tracking-widest">No Activity Yet</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-4 pb-20">
        <AnimatePresence mode="wait">
          {view === 'parent' && (
            <motion.div 
              key="parent"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-black text-indigo-900 dark:text-indigo-100 leading-tight">
                Current House<br />Operations
              </h2>

              <button 
                onClick={() => setShowAddTask(true)}
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 transition-all active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Add Task
              </button>

              {/* Join Requests */}
              {joinRequests.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Join Requests</h3>
                    <Badge variant="pending">{joinRequests.length} Pending</Badge>
                  </div>
                  <div className="space-y-3">
                    {joinRequests.map(request => (
                      <div key={request.id} className="bg-white dark:bg-slate-900 p-4 rounded-[24px] shadow-sm border-2 border-indigo-50 dark:border-slate-800 flex items-center gap-3">
                        <img src={request.avatar} alt={request.name} className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-indigo-900 dark:text-indigo-100 truncate">{request.name}</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Wants to join as {request.role}</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleDeclineRequest(request.id)}
                            className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 flex items-center justify-center hover:bg-rose-200 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => handleAcceptRequest(request)}
                            className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-600 transition-colors"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress Card */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm space-y-4">
                <div className="text-center">
                  <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Today's Progress</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {familyMembers.length > 0 ? 'Your little adventurers are crushing it!' : 'Share the code to start the adventure!'}
                  </p>
                </div>
                
                {familyMembers.length > 0 ? (
                  <div className="space-y-3">
                    {[...familyMembers].sort((a, b) => b.points - a.points).map((member, index) => (
                      <div key={member.id} className="bg-[#F8F8FF] dark:bg-slate-800/50 p-3 rounded-2xl flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${index === 0 ? 'bg-yellow-400 text-white' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400'}`}>
                          {index + 1}
                        </div>
                        <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700" />
                        <div className="flex-1">
                          <p className="text-xs font-bold text-indigo-900 dark:text-indigo-100">{member.name}</p>
                          <div className="flex items-center gap-2">
                            <ProgressBar progress={(member.points % 100)} color="bg-indigo-400" />
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">{member.points} pts</span>
                          </div>
                        </div>
                        {index === 0 && <Trophy className="w-4 h-4 text-yellow-400" />}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 gap-2">
                    <User className="w-12 h-12 opacity-20" />
                    <p className="text-xs font-bold uppercase tracking-widest">No Members Yet</p>
                  </div>
                )}

                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center relative">
                    <Trophy className="w-10 h-10 text-yellow-400" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-white dark:bg-slate-800 rounded-full shadow-sm flex items-center justify-center">
                      <Star className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Approval Stats */}
              <div className="bg-indigo-600 p-4 rounded-[32px] text-white flex items-center justify-between relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-xs font-bold opacity-80 uppercase tracking-wider">Needs Approval</p>
                  <p className="text-4xl font-black">{String(pendingCount).padStart(2, '0')}</p>
                  <p className="text-[10px] mt-1 opacity-70">Quests awaiting your seal.</p>
                </div>
                <div className="opacity-20 absolute -right-4 -bottom-4">
                  <CheckSquare className="w-24 h-24" />
                </div>
              </div>

              {/* Active Quests List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Active Quests</h3>
                  <div className="flex bg-indigo-50 dark:bg-slate-800 p-1 rounded-xl">
                    <button className="px-3 py-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">ALL</button>
                    <button className="px-3 py-1 text-[10px] font-bold bg-indigo-500 text-white rounded-lg shadow-sm">SUBMITTED</button>
                  </div>
                </div>

                <div className="space-y-4">
                  {tasks.filter(t => t.status === 'PENDING').map(task => (
                    <motion.div 
                      layoutId={task.id}
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="bg-white dark:bg-slate-900 p-3 rounded-[24px] shadow-sm flex flex-col gap-3 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0">
                          {task.proofImage ? (
                            <img src={task.proofImage} alt="Proof" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                              <ImageIcon className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="pending">SUBMITTED</Badge>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium truncate">{task.assignedToName} • {task.submittedAt}</span>
                          </div>
                          <h4 className="font-bold text-indigo-900 dark:text-indigo-100 leading-tight text-sm truncate">{task.title}</h4>
                          {task.aiRating && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="flex">
                                {[...Array(5)].map((_, i) => (
                                  <Star key={i} className={`w-2 h-2 ${i < task.aiRating! ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 dark:text-slate-700'}`} />
                                ))}
                              </div>
                              <span className="text-[8px] font-bold text-indigo-500 dark:text-indigo-400 uppercase">AI: {task.aiRating}/5</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleReject(task.id); }}
                          className="flex-1 bg-rose-100 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 py-2.5 rounded-xl flex items-center justify-center hover:bg-rose-200 dark:hover:bg-rose-900/30 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleApprove(task.id); }}
                          className="flex-[3] bg-indigo-500 text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-600 transition-colors text-xs"
                        >
                          <Check className="w-4 h-4" />
                          Approve
                        </button>
                      </div>
                    </motion.div>
                  ))}

                  {tasks.filter(t => t.status === 'TO DO').map(task => (
                    <motion.div 
                      key={task.id}
                      className="bg-white dark:bg-slate-900 p-3 rounded-[24px] shadow-sm flex flex-col gap-3 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${darkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-500'}`}>
                          {task.category === 'Cleaning' && <CheckSquare className="w-5 h-5" />}
                          {task.category === 'Learning' && <ImageIcon className="w-5 h-5" />}
                          {task.category === 'Pets' && <Star className="w-5 h-5" />}
                          {task.category === 'Outdoor' && <Star className="w-5 h-5" />}
                          {task.category === 'Kitchen' && <CheckSquare className="w-5 h-5" />}
                          {task.category === 'General' && <CheckSquare className="w-5 h-5" />}
                          {task.category === 'Health' && <Plus className="w-5 h-5" />}
                          {task.category === 'Social' && <User className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge>TO DO</Badge>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium truncate">{task.assignedToName} • {task.points} pts</span>
                          </div>
                          <h4 className="font-bold text-indigo-900 dark:text-indigo-100 leading-tight text-sm truncate">{task.title}</h4>
                        </div>
                        <div className="flex gap-1">
                          <button 
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-400 transition-colors"
                            title="Delete Quest"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'child' && (
            <motion.div 
              key="child"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {!activeChild ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-400">
                    <User className="w-10 h-10" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-indigo-900 dark:text-indigo-100">No Heroes Found</h2>
                    <p className="text-sm text-slate-400 dark:text-slate-500">Switch to Parent view to add your first adventurer!</p>
                  </div>
                  <button 
                    onClick={() => setView('parent')}
                    className="bg-indigo-500 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20"
                  >
                    Go to Dashboard
                  </button>
                </div>
              ) : (
                <>
                  {/* Child Header Card */}
                  <div className="bg-indigo-500 p-4 rounded-[32px] text-white space-y-4 shadow-xl shadow-indigo-100 dark:shadow-indigo-900/20">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-2xl font-black">Level 14 Explorer</h2>
                        <p className="text-[10px] opacity-80">Just 45 points until your next big reward!</p>
                      </div>
                      <div className="flex gap-1.5">
                        {familyMembers.map(member => (
                          <button 
                            key={member.id}
                            onClick={() => setActiveChildId(member.id)}
                            className={`w-8 h-8 rounded-full border-2 transition-all overflow-hidden ${activeChildId === member.id ? 'border-white scale-110 shadow-lg' : 'border-white/20 opacity-60'}`}
                          >
                            <img src={member.avatar} alt={member.name} />
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="bg-white/10 p-3 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest opacity-60">Total Treasure</p>
                          <p className="text-xl font-black">{activeChild.points.toLocaleString()} <span className="text-xs font-bold opacity-60">pts</span></p>
                        </div>
                        <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center shadow-lg">
                          <Star className="w-5 h-5 text-white fill-white" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] font-bold">
                          <span className="opacity-60 uppercase">Level Progress</span>
                          <span>{activeChild.points % 100} / 100</span>
                        </div>
                        <ProgressBar progress={activeChild.points % 100} color="bg-white" />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-indigo-500 fill-indigo-500" />
                      <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Today's Missions</h3>
                    </div>
                    <Badge>{tasks.filter(t => t.assignedToId === activeChild.id && t.status === 'TO DO').length} Tasks Left</Badge>
                  </div>

                  {/* Task List */}
                  <div className="space-y-3">
                    {tasks.filter(t => t.assignedToId === activeChild.id).length > 0 ? (
                      tasks.filter(t => t.assignedToId === activeChild.id).map(task => (
                        <motion.div 
                          key={task.id} 
                          onClick={() => setSelectedChildTask(task)}
                          className={`bg-white dark:bg-slate-900 p-4 rounded-[24px] shadow-sm border-2 cursor-pointer hover:shadow-md transition-all ${task.status === 'DONE' || task.status === 'APPROVED' ? 'border-green-100 dark:border-green-900/30 bg-green-50/20 dark:bg-green-900/10' : 'border-transparent'}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${task.status === 'DONE' || task.status === 'APPROVED' ? 'bg-green-100 dark:bg-green-900/30 text-green-500 dark:text-green-400' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400'}`}>
                              {task.category === 'Cleaning' && <CheckSquare className="w-5 h-5" />}
                              {task.category === 'Learning' && <ImageIcon className="w-5 h-5" />}
                              {task.category === 'Pets' && <Star className="w-5 h-5" />}
                              {task.category === 'Outdoor' && <Star className="w-5 h-5" />}
                              {task.category === 'Kitchen' && <CheckSquare className="w-5 h-5" />}
                              {task.category === 'General' && <CheckSquare className="w-5 h-5" />}
                              {task.category === 'Health' && <Plus className="w-5 h-5" />}
                              {task.category === 'Social' && <User className="w-5 h-5" />}
                            </div>
                            <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-lg flex items-center gap-1">
                              <Star className="w-2.5 h-2.5 fill-yellow-500 text-yellow-500" />
                              <span className="text-[10px] font-bold">{task.points}</span>
                            </div>
                          </div>

                          <h4 className="text-base font-bold text-indigo-900 dark:text-indigo-100 mb-0.5">{task.title}</h4>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3 leading-tight line-clamp-1">{task.description}</p>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${task.status === 'TO DO' ? 'bg-indigo-500' : task.status === 'PENDING' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                              <span className={`text-[10px] font-bold uppercase tracking-wider ${task.status === 'TO DO' ? 'text-indigo-500' : task.status === 'PENDING' ? 'text-yellow-500' : 'text-green-500'}`}>
                                {task.status === 'PENDING' ? 'WAITING FOR APPROVAL' : task.status}
                              </span>
                            </div>

                            <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="bg-white dark:bg-slate-900 p-10 rounded-[32px] text-center space-y-2 border-2 border-dashed border-slate-100 dark:border-slate-800">
                        <p className="text-sm font-bold text-indigo-900 dark:text-indigo-100">No Missions Assigned</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Enjoy your free time, hero!</p>
                      </div>
                    )}
                  </div>

                  {/* Badges Section */}
                  <div className="space-y-4 pt-4">
                    <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-yellow-500" />
                      Earned Badges
                    </h3>
                    <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                      {[
                        { name: 'Star Cleaner', icon: Star, color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500 dark:text-yellow-400' },
                        { name: 'Speedy Tasker', icon: Clock, color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400' },
                        { name: 'Helper Hero', icon: Trophy, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400' },
                        { name: 'Book Worm', icon: Star, color: 'bg-green-100 dark:bg-green-900/30 text-green-500 dark:text-green-400' },
                      ].map((badge) => (
                        <div key={badge.name} className="flex-shrink-0 flex flex-col items-center gap-2">
                          <div className={`w-16 h-16 rounded-full ${badge.color} flex items-center justify-center shadow-sm`}>
                            <badge.icon className="w-8 h-8" />
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase text-center w-16">{badge.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {view === 'rewards' && (
            <motion.div 
              key="rewards"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {!activeChild ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-400">
                    <Gift className="w-10 h-10" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-indigo-900 dark:text-indigo-100">No Hero Selected</h2>
                    <p className="text-sm text-slate-400 dark:text-slate-500">Add a family member to see rewards!</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-indigo-500 p-8 rounded-[32px] text-white text-center space-y-4 shadow-xl">
                    <p className="text-xs font-bold uppercase tracking-widest opacity-70">Current Treasury</p>
                    <div className="flex items-center justify-center gap-3">
                      <h2 className="text-6xl font-black">{activeChild.points}</h2>
                      <Star className="w-10 h-10 text-yellow-400 fill-yellow-400" />
                    </div>
                    <p className="text-sm font-medium opacity-90">You've earned 12 stars today!<br />Keep going, hero.</p>
                    <div className="w-full max-w-[200px] mx-auto aspect-square bg-indigo-600 rounded-3xl p-4 shadow-inner flex items-center justify-center">
                       <Trophy className="w-24 h-24 text-yellow-400" />
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-6 rounded-[32px] shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Weekly Adventure</h3>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Goal: Pizza Night Celebration</p>
                      </div>
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 px-3 py-1 rounded-xl">
                        <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400">85% Complete</span>
                      </div>
                    </div>
                    <ProgressBar progress={85} />
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500">
                      <div className="flex -space-x-2">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`} alt="User" />
                          </div>
                        ))}
                        <div className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-800 bg-indigo-500 text-white flex items-center justify-center text-[8px]">+2</div>
                      </div>
                      <span>170 / 200 Stars Collected</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">The Treasure Chest</p>
                        <h3 className="text-xl font-black text-indigo-900 dark:text-indigo-100">Rewards Store</h3>
                      </div>
                      <button className="text-xs font-bold text-indigo-500 dark:text-indigo-400">See All</button>
                    </div>

                    <div className="space-y-4">
                      {REWARDS.map(reward => (
                        <div key={reward.id} className="bg-white dark:bg-slate-900 rounded-[24px] overflow-hidden shadow-sm border border-slate-50 dark:border-slate-800 group">
                          <div className="relative h-40">
                            <img src={reward.image} alt={reward.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                            <div className="absolute top-4 right-4 bg-yellow-400 text-white px-3 py-1 rounded-lg font-bold text-xs shadow-lg">
                              {reward.cost} STARS
                            </div>
                          </div>
                          <div className="p-5 space-y-3">
                            <h4 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">{reward.title}</h4>
                            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">{reward.description}</p>
                            <button 
                              disabled={activeChild.points < reward.cost}
                              onClick={() => handleClaimReward(reward.id)}
                              className={`w-full py-3 rounded-xl font-bold transition-all active:scale-95 ${activeChild.points >= reward.cost ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'}`}
                            >
                              {activeChild.points >= reward.cost ? 'Unlock Reward' : `Need ${reward.cost - activeChild.points} more stars`}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-6 left-6 right-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 h-20 rounded-[28px] shadow-2xl flex items-center justify-around px-4 z-40">
        <button 
          onClick={() => setView('parent')}
          className={`flex flex-col items-center gap-1 transition-all ${view === 'parent' ? 'text-indigo-600 dark:text-indigo-400 scale-110' : 'text-slate-400 dark:text-slate-600'}`}
        >
          <div className={`p-2 rounded-2xl ${view === 'parent' ? 'bg-indigo-100 dark:bg-indigo-900/30' : ''}`}>
            <LayoutDashboard className="w-6 h-6" />
          </div>
          <span className="text-[8px] font-black uppercase tracking-widest">Dashboard</span>
        </button>
        <button 
          onClick={() => setView('child')}
          className={`flex flex-col items-center gap-1 transition-all ${view === 'child' ? 'text-indigo-600 dark:text-indigo-400 scale-110' : 'text-slate-400 dark:text-slate-600'}`}
        >
          <div className={`p-2 rounded-2xl ${view === 'child' ? 'bg-indigo-100 dark:bg-indigo-900/30' : ''}`}>
            <CheckSquare className="w-6 h-6" />
          </div>
          <span className="text-[8px] font-black uppercase tracking-widest">Tasks</span>
        </button>
        <button 
          onClick={() => setView('rewards')}
          className={`flex flex-col items-center gap-1 transition-all ${view === 'rewards' ? 'text-indigo-600 dark:text-indigo-400 scale-110' : 'text-slate-400 dark:text-slate-600'}`}
        >
          <div className={`p-2 rounded-2xl ${view === 'rewards' ? 'bg-indigo-100 dark:bg-indigo-900/30' : ''}`}>
            <Gift className="w-6 h-6" />
          </div>
          <span className="text-[8px] font-black uppercase tracking-widest">Rewards</span>
        </button>
      </nav>

      {/* Modals */}
      <AnimatePresence>
        {selectedTask && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-indigo-900/40 backdrop-blur-sm flex items-end"
            onClick={() => setSelectedTask(null)}
          >
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white dark:bg-slate-900 w-full rounded-t-[40px] p-8 space-y-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mx-auto" />
              
              <div className="flex justify-between items-start">
                <div>
                  <Badge variant="pending">Reviewing Proof</Badge>
                  <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-100 mt-2">{selectedTask.title}</h3>
                  <p className="text-sm text-slate-400 dark:text-slate-500">{selectedTask.assignedToName} • {selectedTask.submittedAt}</p>
                </div>
                <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-4 py-2 rounded-2xl flex items-center gap-2">
                  <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  <span className="font-bold">{selectedTask.points} pts</span>
                </div>
              </div>

              <div className="aspect-video bg-slate-100 dark:bg-slate-800 rounded-[32px] overflow-hidden shadow-inner relative">
                {selectedTask.proofImage ? (
                  <img src={selectedTask.proofImage} alt="Proof" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                    <ImageIcon className="w-12 h-12" />
                  </div>
                )}
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-indigo-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white gap-2">
                    <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                    <p className="text-xs font-bold uppercase tracking-widest">AI Reviewing...</p>
                  </div>
                )}
              </div>

              {selectedTask.aiRating && (
                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl space-y-2 border border-indigo-100 dark:border-indigo-900/30">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">AI Assistant Review</p>
                    <div className="flex gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < selectedTask.aiRating! ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 dark:text-slate-700'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-indigo-900 dark:text-indigo-100 font-medium italic">"{selectedTask.aiFeedback}"</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Mission Description</p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{selectedTask.description}</p>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => handleReject(selectedTask.id)}
                  className="flex-1 bg-rose-100 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-rose-200 dark:hover:bg-rose-900/30 transition-colors"
                >
                  <X className="w-5 h-5" />
                  Reject
                </button>
                <button 
                  onClick={() => handleApprove(selectedTask.id)}
                  className="flex-[2] bg-indigo-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 hover:bg-indigo-600 transition-colors"
                >
                  <Check className="w-5 h-5" />
                  Approve & Reward
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showAddTask && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-indigo-900/40 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setShowAddTask(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[40px] p-8 space-y-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-100">New Quest</h3>
                <button onClick={() => setShowAddTask(false)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">Quest Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Mow the Lawn" 
                    value={newTask.title}
                    onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all dark:text-white dark:placeholder:text-slate-600" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">Assign To</label>
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {familyMembers.map(member => (
                      <button 
                        key={member.id} 
                        onClick={() => setNewTask(prev => ({ ...prev, assignedToName: member.name, assignedToId: member.id }))}
                        className={`flex-1 min-w-[80px] py-3 rounded-2xl font-bold border-2 transition-all ${newTask.assignedToName === member.name ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:border-indigo-300 dark:hover:border-indigo-700'}`}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">Category</label>
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {['General', 'Cleaning', 'Learning', 'Pets', 'Outdoor', 'Kitchen', 'Health', 'Social'].map(cat => (
                      <button 
                        key={cat} 
                        onClick={() => setNewTask(prev => ({ ...prev, category: cat }))}
                        className={`px-4 py-2 rounded-xl font-bold text-xs border-2 transition-all ${newTask.category === cat ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:border-indigo-300 dark:hover:border-indigo-700'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">Treasure Value (Pts)</label>
                  <div className="flex gap-2">
                    {[10, 25, 50, 100].map(val => (
                      <button 
                        key={val} 
                        onClick={() => setNewTask(prev => ({ ...prev, points: val }))}
                        className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${newTask.points === val ? 'bg-yellow-400 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/20'}`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={handleAddTask}
                disabled={!newTask.title || !newTask.assignedToId}
                className="w-full bg-indigo-500 disabled:opacity-50 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 active:scale-95 transition-transform"
              >
                Launch Quest
              </button>
            </motion.div>
          </motion.div>
        )}
        {selectedChildTask && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-indigo-900/40 backdrop-blur-sm flex items-end"
            onClick={() => setSelectedChildTask(null)}
          >
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white dark:bg-slate-900 w-full rounded-t-[40px] p-8 space-y-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mx-auto" />
              
              <div className="flex justify-between items-start">
                <div>
                  <Badge variant={selectedChildTask.status === 'TO DO' ? 'default' : selectedChildTask.status === 'PENDING' ? 'pending' : 'success'}>
                    {selectedChildTask.status}
                  </Badge>
                  <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-100 mt-2">{selectedChildTask.title}</h3>
                  <p className="text-sm text-slate-400 dark:text-slate-500">Mission Category: {selectedChildTask.category}</p>
                </div>
                <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-4 py-2 rounded-2xl flex items-center gap-2">
                  <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  <span className="font-bold">{selectedChildTask.points} pts</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Mission Briefing</p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{selectedChildTask.description}</p>
              </div>

              {selectedChildTask.aiRating && (
                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-3xl space-y-2 border border-indigo-100 dark:border-indigo-900/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-indigo-500 rounded-lg flex items-center justify-center">
                        <Star className="w-3 h-3 text-white fill-white" />
                      </div>
                      <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">AI Instant Feedback</p>
                    </div>
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < selectedChildTask.aiRating! ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 dark:text-slate-700'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-indigo-900 dark:text-indigo-100 font-medium italic leading-relaxed">"{selectedChildTask.aiFeedback}"</p>
                </div>
              )}

              {selectedChildTask.status === 'TO DO' ? (
                <div className="space-y-4">
                  <div className="relative p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[32px] flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-600 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all cursor-pointer">
                    <Camera className="w-10 h-10" />
                    <p className="text-xs font-bold">Snap a photo to complete!</p>
                    <input 
                      type="file" 
                      accept="image/*" 
                      capture="environment"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadProof(selectedChildTask.id, file);
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-center text-slate-400 dark:text-slate-600 font-medium">Tap the area above to open your camera</p>
                </div>
              ) : (
                <div className="p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center text-indigo-500 dark:text-indigo-400">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-indigo-900 dark:text-indigo-100">Waiting for Approval</p>
                    <p className="text-[10px] text-indigo-400">A Commander will review your proof soon!</p>
                  </div>
                </div>
              )}

              <button 
                onClick={() => setSelectedChildTask(null)}
                className="w-full py-4 text-slate-400 dark:text-slate-600 font-bold"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
        {showManageFamily && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-indigo-900/40 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setShowManageFamily(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[40px] p-8 space-y-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-100">Manage Family</h3>
                <button onClick={() => setShowManageFamily(false)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-[28px] space-y-1 border border-indigo-100 dark:border-indigo-900/30 text-center relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-[9px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">Invite Code</p>
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-2xl font-black text-indigo-900 dark:text-indigo-100 tracking-[0.2em] my-0.5">{family.code}</p>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(family.code);
                        addNotification("Invite code copied!", "success");
                      }}
                      className="p-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-400 transition-colors"
                      title="Copy Code"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium">Heroes join by entering this code.</p>
                </div>
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Trophy className="w-20 h-20" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-100 uppercase tracking-wider">Family Visibility</h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{isLocked ? 'Locked (Private)' : 'Unlocked (Public)'}</p>
                  </div>
                  <button 
                    onClick={toggleFamilyLock}
                    className={`w-12 h-6 rounded-full relative transition-colors ${isLocked ? 'bg-slate-400' : 'bg-indigo-500'}`}
                  >
                    <motion.div 
                      animate={{ x: isLocked ? 4 : 28 }}
                      className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between px-1">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Family Members</h4>
                  <Badge>{familyMembers.length}</Badge>
                </div>
                {familyMembers.map(member => (
                  <div key={member.id} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl group border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/30 transition-all">
                    <button 
                      onClick={() => setEditingAvatarMemberId(member.id)}
                      className="relative group/avatar shrink-0"
                    >
                      <img src={member.avatar} alt={member.name} className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 group-hover/avatar:opacity-50 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                        <Camera className="w-3 h-3 text-indigo-500" />
                      </div>
                    </button>
                    <input 
                      type="text" 
                      defaultValue={member.name}
                      onBlur={(e) => handleRenameMember(member.id, e.target.value)}
                      className="flex-1 bg-transparent border-none font-bold text-indigo-900 dark:text-indigo-100 focus:ring-0 p-0 text-xs"
                    />
                    <button 
                      onClick={() => handleRemoveMember(member.id)}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-all text-[9px] font-bold uppercase tracking-wider"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}

                <div className="pt-2">
                  <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-4 rounded-2xl border-2 border-dashed border-indigo-100 dark:border-indigo-900/20 text-center">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">How to add members?</p>
                    <p className="text-[10px] text-slate-400 mt-1">New heroes join by entering the invite code above on their own device.</p>
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-3">
                <button 
                  onClick={() => setShowManageFamily(false)}
                  className="w-full bg-indigo-500 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 active:scale-95 transition-transform"
                >
                  Save Changes
                </button>
                <button 
                  onClick={() => setShowLeaveConfirm(true)}
                  className="w-full bg-rose-50 dark:bg-rose-900/10 text-rose-500 py-4 rounded-2xl font-bold hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Leave Family
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {showLeaveConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowLeaveConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[40px] p-8 space-y-6 shadow-2xl text-center"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-rose-100 dark:bg-rose-900/30 rounded-full flex items-center justify-center text-rose-500 mx-auto">
                <ArrowLeft className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-100">Leave Family?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Are you sure you want to leave? All your local progress and stars will be lost forever!</p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleLeaveFamily}
                  className="w-full bg-rose-500 text-white py-4 rounded-2xl font-bold shadow-lg shadow-rose-100 dark:shadow-rose-900/20 active:scale-95 transition-transform"
                >
                  Yes, Leave Family
                </button>
                <button 
                  onClick={() => setShowLeaveConfirm(false)}
                  className="w-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-4 rounded-2xl font-bold active:scale-95 transition-transform"
                >
                  Stay in Family
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {editingAvatarMemberId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-indigo-900/40 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setEditingAvatarMemberId(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[40px] p-8 space-y-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-indigo-900 dark:text-indigo-100">Choose Avatar</h3>
                <button onClick={() => setEditingAvatarMemberId(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="grid grid-cols-4 gap-4 max-h-[300px] overflow-y-auto p-2 no-scrollbar">
                {[
                  'Alex', 'Sam', 'Jordan', 'Charlie', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Quinn', 'Skyler',
                  'Parker', 'Avery', 'Eden', 'Sage', 'Rowan', 'Felix', 'Luna', 'Milo', 'Nova', 'Leo'
                ].map(seed => {
                  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
                  const isCurrent = familyMembers.find(m => m.id === editingAvatarMemberId)?.avatar === avatarUrl;
                  
                  return (
                    <button 
                      key={seed}
                      onClick={() => handleUpdateAvatar(editingAvatarMemberId!, avatarUrl)}
                      className={`aspect-square rounded-2xl border-2 transition-all overflow-hidden p-1 ${isCurrent ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-transparent hover:border-indigo-200 dark:hover:border-indigo-800 bg-slate-50 dark:bg-slate-800'}`}
                    >
                      <img src={avatarUrl} alt={seed} className="w-full h-full" />
                    </button>
                  );
                })}
              </div>
              
              <button 
                onClick={() => setEditingAvatarMemberId(null)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 py-4 rounded-2xl font-bold active:scale-95 transition-transform"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
