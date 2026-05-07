/* PitchPredictions — Auth via Supabase */

const SUPA_URL = 'https://bzyvjpujyxikhyfmqevt.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6eXZqcHVqeXhpa2h5Zm1xZXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzk3NzQsImV4cCI6MjA5MzY1NTc3NH0.3Bp2u2rC4Rk9Tgj8SW-vq3Znoxe_NCLYvM0G0TIjm84';

const db = supabase.createClient(SUPA_URL, SUPA_KEY);
let _user = null;

async function initAuth() {
    const { data: { session } } = await db.auth.getSession();
    _user = session?.user || null;
    _updateAuthUI();
    if (_user) {
        loadPinnedTeams();
        loadSavedAnalyses();
    }

    db.auth.onAuthStateChange(async (event, session) => {
        _user = session?.user || null;
        _updateAuthUI();
        if (event === 'SIGNED_IN') {
            closeAuthModal();
            loadPinnedTeams();
            loadSavedAnalyses();
            if (typeof loadSubscription === 'function') loadSubscription();
        }
        if (event === 'SIGNED_OUT') {
            if (typeof renderPinnedTeams === 'function')  renderPinnedTeams([]);
            if (typeof renderSavedAnalyses === 'function') renderSavedAnalyses([]);
        }
    });
}

function getUser() { return _user; }

async function authSignUp(email, password) {
    const { error } = await db.auth.signUp({ email, password });
    if (error) throw error;
}

async function authSignIn(email, password) {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
}

async function authGoogle() {
    const { error } = await db.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
}

async function authSignOut() {
    await db.auth.signOut();
}

function openAuthModal(mode) {
    mode = mode || 'login';
    document.getElementById('authModal').classList.remove('hidden');
    if (mode === 'signup') {
        document.getElementById('loginFormInner').classList.add('hidden');
        document.getElementById('signupFormInner').classList.remove('hidden');
    } else {
        document.getElementById('loginFormInner').classList.remove('hidden');
        document.getElementById('signupFormInner').classList.add('hidden');
    }
    document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');
    document.body.style.overflow = '';
}

function _updateAuthUI() {
    const loginBtn  = document.getElementById('loginBtn');
    const userMenu  = document.getElementById('userMenu');
    const userLabel = document.getElementById('userLabel');
    if (_user) {
        loginBtn?.classList.add('hidden');
        userMenu?.classList.remove('hidden');
        if (userLabel) userLabel.textContent = _user.email.split('@')[0];
    } else {
        loginBtn?.classList.remove('hidden');
        userMenu?.classList.add('hidden');
    }
}

function initAuthModal() {
    document.getElementById('loginBtn')?.addEventListener('click', () => openAuthModal('login'));
    document.getElementById('authModalClose')?.addEventListener('click', closeAuthModal);
    document.getElementById('authModal')?.addEventListener('click', e => {
        if (e.target.id === 'authModal') closeAuthModal();
    });

    document.getElementById('toSignupBtn')?.addEventListener('click', () => {
        document.getElementById('loginFormInner').classList.add('hidden');
        document.getElementById('signupFormInner').classList.remove('hidden');
        clearAuthErrors();
    });
    document.getElementById('toLoginBtn')?.addEventListener('click', () => {
        document.getElementById('signupFormInner').classList.add('hidden');
        document.getElementById('loginFormInner').classList.remove('hidden');
        clearAuthErrors();
    });

    document.getElementById('loginSubmitBtn')?.addEventListener('click', async () => {
        const email = document.getElementById('authEmail').value.trim();
        const pass  = document.getElementById('authPassword').value;
        const errEl = document.getElementById('loginError');
        errEl.classList.add('hidden');
        const btn = document.getElementById('loginSubmitBtn');
        btn.textContent = 'Signing in...'; btn.disabled = true;
        try {
            await authSignIn(email, pass);
        } catch (e) {
            errEl.textContent = e.message;
            errEl.classList.remove('hidden');
        } finally {
            btn.textContent = 'Sign In'; btn.disabled = false;
        }
    });

    document.getElementById('signupSubmitBtn')?.addEventListener('click', async () => {
        const email = document.getElementById('signupEmail').value.trim();
        const pass  = document.getElementById('signupPassword').value;
        const errEl = document.getElementById('signupError');
        errEl.classList.add('hidden');
        const btn = document.getElementById('signupSubmitBtn');
        btn.textContent = 'Creating...'; btn.disabled = true;
        try {
            await authSignUp(email, pass);
            errEl.style.color = 'var(--green)';
            errEl.style.background = 'var(--green-pale)';
            errEl.style.borderColor = '#c3e6cb';
            errEl.textContent = 'Account created! Check your email to confirm, then sign in.';
            errEl.classList.remove('hidden');
        } catch (e) {
            errEl.style.color = '';
            errEl.style.background = '';
            errEl.style.borderColor = '';
            errEl.textContent = e.message;
            errEl.classList.remove('hidden');
        } finally {
            btn.textContent = 'Create Account'; btn.disabled = false;
        }
    });

    document.getElementById('googleLoginBtn')?.addEventListener('click', () => authGoogle());
    document.getElementById('googleSignupBtn')?.addEventListener('click', () => authGoogle());

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        await authSignOut();
    });

    ['authPassword', 'signupPassword'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            if (id === 'authPassword') document.getElementById('loginSubmitBtn').click();
            else document.getElementById('signupSubmitBtn').click();
        });
    });
}

function clearAuthErrors() {
    ['loginError', 'signupError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.style = ''; }
    });
}
