import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleAuthProvider } from '../../lib/firebase.ts';
import { apiFetch } from '../../lib/api.ts';
import { useAuthStore } from '../../stores/useAuthStore.ts';
import type { AuthUser } from '../../types/litera.ts';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

const registerSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters.'),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  accountType: z.enum(['reader', 'author']),
  penName: z.string().optional(),
});

const resetRequestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

type LoginInput = z.infer<typeof loginSchema>;
type RegisterInput = z.infer<typeof registerSchema>;
type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export function AuthModal() {
  const { authModalOpen, setAuthModalOpen, setSession, refreshMe } = useAuthStore();
  const [tab, setTab] = useState<'login' | 'register' | 'reset'>('login');
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loginForm = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { accountType: 'reader' },
  });
  const resetForm = useForm<ResetRequestInput>({ resolver: zodResolver(resetRequestSchema) });

  if (!authModalOpen) return null;

  const accountTypeWatch = registerForm.watch('accountType');

  async function handleLogin(data: LoginInput) {
    setBusy(true);
    setServerError(null);
    try {
      const res = await apiFetch<{ user: AuthUser; sessionToken: string }>('/api/auth/login', {
        method: 'POST',
        json: data,
      });
      setSession({ user: res.user, token: res.sessionToken });
      await refreshMe();
      setAuthModalOpen(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(data: RegisterInput) {
    setBusy(true);
    setServerError(null);
    try {
      const res = await apiFetch<{ user: AuthUser; sessionToken: string }>('/api/auth/register', {
        method: 'POST',
        json: data,
      });
      setSession({ user: res.user, token: res.sessionToken });
      await refreshMe();
      setAuthModalOpen(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRequest(data: ResetRequestInput) {
    setBusy(true);
    setServerError(null);
    setServerNotice(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/password-reset/request', {
        method: 'POST',
        json: data,
      });
      setServerNotice(res.message);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to send recovery instructions.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setServerError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setSession({ user: null, token: idToken });
      await refreshMe();
      setAuthModalOpen(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Google sign-in could not complete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="litera-auth-title"
    >
      <div className="relative w-full max-w-md border border-[#E6DFD1] bg-[#FBF9F5] p-8 shadow-lg">
        <button
          type="button"
          onClick={() => setAuthModalOpen(false)}
          aria-label="Close sign-in dialog"
          className="absolute top-5 right-5 cursor-pointer p-1 text-[#57534E] hover:text-[#1C1917]"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="litera-auth-title" className="font-display text-2xl font-semibold text-[#1C1917]">
          {tab === 'login' ? 'Sign in to Litera' : tab === 'register' ? 'Create an Account' : 'Recover Password'}
        </h2>
        <p className="mt-1 text-sm text-[#57534E]">
          Synchronize your shelf, annotations, and manuscripts.
        </p>

        <div className="mt-5 flex border-b border-[#E6DFD1] text-sm">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setServerError(null);
              setServerNotice(null);
            }}
            className={`cursor-pointer border-b-2 px-3 py-2 font-medium whitespace-nowrap ${
              tab === 'login' ? 'border-[#785032] text-[#1C1917]' : 'border-transparent text-[#57534E]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setServerError(null);
              setServerNotice(null);
            }}
            className={`cursor-pointer border-b-2 px-3 py-2 font-medium whitespace-nowrap ${
              tab === 'register' ? 'border-[#785032] text-[#1C1917]' : 'border-transparent text-[#57534E]'
            }`}
          >
            Register
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('reset');
              setServerError(null);
              setServerNotice(null);
            }}
            className={`cursor-pointer border-b-2 px-3 py-2 font-medium whitespace-nowrap ${
              tab === 'reset' ? 'border-[#785032] text-[#1C1917]' : 'border-transparent text-[#57534E]'
            }`}
          >
            Recovery
          </button>
        </div>

        {serverError ? (
          <div className="mt-4 border border-[#991B1B]/30 bg-[#FEF2F2] px-3 py-2.5 text-xs text-[#991B1B]">
            {serverError}
          </div>
        ) : null}

        {serverNotice ? (
          <div className="mt-4 border border-[#166534]/30 bg-[#F0FDF4] px-3 py-2.5 text-xs text-[#166534]">
            {serverNotice}
          </div>
        ) : null}

        {tab === 'login' ? (
          <form onSubmit={loginForm.handleSubmit(handleLogin)} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Email</label>
              <input
                type="email"
                {...loginForm.register('email')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
                placeholder="reader@domain.org"
              />
              {loginForm.formState.errors.email ? (
                <p className="mt-1 text-xs text-[#991B1B]">{loginForm.formState.errors.email.message}</p>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Password</label>
              <input
                type="password"
                {...loginForm.register('password')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
              {loginForm.formState.errors.password ? (
                <p className="mt-1 text-xs text-[#991B1B]">{loginForm.formState.errors.password.message}</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer bg-[#785032] py-2.5 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24] disabled:opacity-60"
            >
              {busy ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : null}

        {tab === 'register' ? (
          <form onSubmit={registerForm.handleSubmit(handleRegister)} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Account Role</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="flex cursor-pointer items-center gap-2 border border-[#D6CEBE] bg-white px-3 py-2 text-xs">
                  <input type="radio" value="reader" {...registerForm.register('accountType')} />
                  <span>Reader</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 border border-[#D6CEBE] bg-white px-3 py-2 text-xs">
                  <input type="radio" value="author" {...registerForm.register('accountType')} />
                  <span>Author</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Full Name</label>
              <input
                type="text"
                {...registerForm.register('displayName')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
              {registerForm.formState.errors.displayName ? (
                <p className="mt-1 text-xs text-[#991B1B]">{registerForm.formState.errors.displayName.message}</p>
              ) : null}
            </div>
            {accountTypeWatch === 'author' ? (
              <div>
                <label className="block text-xs font-medium text-[#1C1917]">Pen Name (Optional)</label>
                <input
                  type="text"
                  {...registerForm.register('penName')}
                  className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
                />
              </div>
            ) : null}
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Email</label>
              <input
                type="email"
                {...registerForm.register('email')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
              {registerForm.formState.errors.email ? (
                <p className="mt-1 text-xs text-[#991B1B]">{registerForm.formState.errors.email.message}</p>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Password (min 8 characters)</label>
              <input
                type="password"
                {...registerForm.register('password')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
              {registerForm.formState.errors.password ? (
                <p className="mt-1 text-xs text-[#991B1B]">{registerForm.formState.errors.password.message}</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer bg-[#785032] py-2.5 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24] disabled:opacity-60"
            >
              {busy ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
        ) : null}

        {tab === 'reset' ? (
          <form onSubmit={resetForm.handleSubmit(handleResetRequest)} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#1C1917]">Account Email</label>
              <input
                type="email"
                {...resetForm.register('email')}
                className="mt-1 w-full border border-[#D6CEBE] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#785032] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer bg-[#785032] py-2.5 text-sm font-medium text-[#FBF9F5] transition-colors hover:bg-[#5E3D24] disabled:opacity-60"
            >
              Send Recovery Instructions
            </button>
          </form>
        ) : null}

        <div className="my-5 flex items-center gap-3 text-xs text-[#57534E]">
          <div className="h-px flex-1 bg-[#E6DFD1]" />
          <span>or</span>
          <div className="h-px flex-1 bg-[#E6DFD1]" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={busy}
          className="w-full cursor-pointer border border-[#D6CEBE] bg-white py-2.5 text-sm font-medium text-[#1C1917] transition-colors hover:border-[#785032]"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
