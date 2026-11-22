import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createWaiterApi, WaiterApiError } from './src/apiClient.js';
import { getWaiterApiEnvironment } from './src/apiConfig.js';
import { translate } from './src/i18n.js';
import { createWaiterSessionStore } from './src/sessionStore.js';
import { createWaiterCatalogCache } from './src/catalogCache.js';
import { createWaiterOrderOutbox, syncOneWaiterOrder } from './src/orderOutbox.js';

let API_ORIGINS = [];
try { API_ORIGINS = getWaiterApiEnvironment(); } catch { API_ORIGINS = []; }
const sessionStore = createWaiterSessionStore(SecureStore);

function moneyMinor(price) {
  const [whole, fraction = ''] = String(price).split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function moneyLabel(minor, currency) {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `${whole}.${fraction} ${currency}`;
}

function errorLabel(error, t) {
  if (error instanceof WaiterApiError && error.status === 401 && error.code === 'invalid_credentials') return t('badCredentials');
  if (error instanceof WaiterApiError && error.status === 401) return t('reauth');
  if (error instanceof WaiterApiError && error.status === 0) return t('networkError');
  if (error instanceof WaiterApiError && error.status === 403) return t('forbidden');
  return t('genericError');
}

function Action({ title, onPress, disabled = false, secondary = false }) {
  return (
    <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={[styles.action, secondary && styles.secondaryAction, disabled && styles.disabled]}>
      <Text style={[styles.actionText, secondary && styles.secondaryActionText]}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState(null);
  const [bootError, setBootError] = useState('');
  const [session, setSession] = useState(null);
  const [previousSession, setPreviousSession] = useState(null);
  const [language, setLanguage] = useState('ar');
  const t = key => translate(language, key);
  const isRtl = language === 'ar';
  const changeLanguage = () => setLanguage(current => {
    const next = current === 'ar' ? 'en' : 'ar';
    SecureStore.setItemAsync('restaurant-pos.waiter.language.v1', next).catch(() => {});
    return next;
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const [cart, setCart] = useState({});
  const [queue, setQueue] = useState([]);

  const api = useMemo(() => {
    if (!API_ORIGINS.length) return null;
    try { return createWaiterApi({ apiOrigins: API_ORIGINS }); }
    catch { return null; }
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync('restaurant-pos.waiter.language.v1').then(saved => {
      if (saved === 'ar' || saved === 'en') setLanguage(saved);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!API_ORIGINS.length || !api) throw new Error(t('setupHint'));
        const db = await SQLite.openDatabaseAsync('restaurant-pos-waiter.db');
        const catalogCache = createWaiterCatalogCache(db);
        const outbox = createWaiterOrderOutbox(db);
        await catalogCache.initialize();
        await outbox.initialize();
        if (!active) return;
        setRuntime({ db, catalogCache, outbox });
        const saved = await sessionStore.load();
        if (saved && active) {
          setPreviousSession(saved);
          setEmail(saved.user.email);
          try {
            const user = await api.getMe(saved.accessToken);
            if (user.id !== saved.user.id || user.restaurantId !== saved.user.restaurantId || user.role !== saved.user.role) {
              throw new Error('session_identity_changed');
            }
            if (active) {
              setSession(saved);
              setPreviousSession(null);
            }
          } catch (error) {
            if (active && error instanceof WaiterApiError && error.status === 0) {
              setPreviousSession(null);
              setSession(saved);
              setNotice(t('offline'));
            } else if (active) {
              setNotice(t('reauth'));
            }
          }
        }
      } catch (error) {
        if (active) setBootError(error?.message || t('bootFailure'));
      }
    })();
    return () => { active = false; };
  }, [api]);

  const loadQueue = useCallback(async (activeSession = session) => {
    if (!runtime || !activeSession) return [];
    const rows = await runtime.outbox.list({ restaurantId: activeSession.user.restaurantId, userId: activeSession.user.id, limit: 100 });
    setQueue(rows);
    return rows;
  }, [runtime, session]);

  const refreshCatalog = useCallback(async (activeSession = session) => {
    if (!runtime || !activeSession || !api) return null;
    try {
      const snapshot = await api.getCatalog(activeSession.accessToken, activeSession.user.restaurantId);
      await runtime.catalogCache.replaceSnapshot({ restaurantId: activeSession.user.restaurantId, snapshot });
      const saved = await runtime.catalogCache.getSnapshot({ restaurantId: activeSession.user.restaurantId });
      setCatalog(saved);
      setSelectedAreaId(current => saved.serviceAreas.some(area => area.id === current) ? current : (saved.serviceAreas[0]?.id || ''));
      setSelectedTableId(current => saved.tables.some(table => table.id === current && table.status !== 'disabled') ? current : '');
      setNotice(saved.stale ? t('staleTable') : t('catalogUpdated'));
      return saved;
    } catch (error) {
      if (error instanceof WaiterApiError && error.status === 401) {
        setPreviousSession(activeSession);
        setSession(null);
        setNotice(t('expired'));
        return null;
      }
      const saved = await runtime.catalogCache.getSnapshot({ restaurantId: activeSession.user.restaurantId });
      if (saved) {
        setCatalog(saved);
        setSelectedAreaId(current => saved.serviceAreas.some(area => area.id === current) ? current : (saved.serviceAreas[0]?.id || ''));
        setSelectedTableId(current => saved.tables.some(table => table.id === current && table.status !== 'disabled') ? current : '');
        setNotice(`${errorLabel(error, t)} ${saved.stale ? t('catalogOld') : t('catalogAvailable')}`);
        return saved;
      }
      setNotice(errorLabel(error, t));
      return null;
    }
  }, [runtime, session, api]);

  useEffect(() => {
    if (!session || !runtime) return;
    refreshCatalog(session);
    loadQueue(session);
  }, [session, runtime, refreshCatalog, loadQueue]);

  async function handleLogin() {
    if (!runtime || !api) return;
    setBusy(true); setNotice('');
    try {
      const result = await api.login({ email, password });
      const verifiedUser = await api.getMe(result.accessToken);
      if (verifiedUser.id !== result.user.id || verifiedUser.restaurantId !== result.user.restaurantId || verifiedUser.role !== result.user.role) {
        throw new Error(t('identityCheck'));
      }
      if (previousSession && (previousSession.user.id !== verifiedUser.id || previousSession.user.restaurantId !== verifiedUser.restaurantId)) {
        const oldRows = await runtime.outbox.list({ restaurantId: previousSession.user.restaurantId, userId: previousSession.user.id, limit: 100 });
        if (oldRows.some(row => row.status !== 'synced')) {
          throw new Error(t('oldAccount'));
        }
      }
      const nextSession = await sessionStore.save({ accessToken: result.accessToken, user: verifiedUser });
      setPreviousSession(null);
      setSession(nextSession);
      setPassword('');
      setNotice(t('loginDone'));
    } catch (error) {
      setNotice(error instanceof WaiterApiError ? errorLabel(error, t) : (error?.message || t('loginFailure')));
    } finally { setBusy(false); }
  }

  async function handleLogout() {
    if (!session || !runtime) return;
    const rows = await runtime.outbox.list({ restaurantId: session.user.restaurantId, userId: session.user.id, limit: 100 });
    if (rows.some(row => row.status !== 'synced')) {
      Alert.alert(t('logoutBlockedTitle'), t('logoutBlocked'));
      return;
    }
    await sessionStore.clear();
    setSession(null); setPreviousSession(null); setCatalog(null); setQueue([]); setCart({}); setPassword('');
  }

  async function syncQueue() {
    if (!session || !runtime) return;
    setBusy(true);
    try {
      for (let index = 0; index < 20; index += 1) {
        const result = await syncOneWaiterOrder({
          outbox: runtime.outbox, restaurantId: session.user.restaurantId, userId: session.user.id,
          leaseToken: Crypto.randomUUID(), apiOrigins: API_ORIGINS, accessToken: session.accessToken
        });
        if (result.status === 'idle' || result.status === 'pending' || result.status === 'failed') break;
        if (result.status === 'auth_required') {
          setPreviousSession(session); setSession(null);
          setNotice(t('authSync'));
          break;
        }
      }
      await loadQueue(session);
    } catch (error) { setNotice(errorLabel(error, t)); }
    finally { setBusy(false); }
  }

  async function submitOrder() {
    if (!session || !runtime || !selectedTableId) return;
    const items = Object.values(cart).map(entry => ({ menuItemId: entry.item.id, quantity: entry.quantity }));
    if (!items.length) return;
    setBusy(true);
    try {
      await runtime.outbox.enqueue({
        restaurantId: session.user.restaurantId, userId: session.user.id,
        localId: Crypto.randomUUID(), idempotencyKey: Crypto.randomUUID(),
        payload: { tableId: selectedTableId, items }
      });
      setCart({});
      setNotice(t('savedLocal'));
      await loadQueue(session);
      await syncQueue();
    } catch (error) { setNotice(errorLabel(error, t)); }
    finally { setBusy(false); }
  }

  const areaTables = catalog?.tables.filter(table => table.serviceAreaId === selectedAreaId && table.status !== 'disabled') || [];
  const activeItems = catalog?.items.filter(item => item.active) || [];
  const cartEntries = Object.values(cart);
  const cartTotal = cartEntries.reduce((sum, entry) => sum + moneyMinor(entry.item.price) * entry.quantity, 0);
  const pendingCount = queue.filter(row => row.status !== 'synced').length;

  if (bootError) {
    return <SafeAreaView style={styles.center}><StatusBar style="auto"/><Text style={[styles.title, { textAlign: isRtl ? 'right' : 'left' }]}>{t('setupTitle')}</Text><Text style={[styles.notice, { textAlign: isRtl ? 'right' : 'left' }]}>{bootError}</Text><Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{t('setupHint')}</Text></SafeAreaView>;
  }
  if (!runtime) return <SafeAreaView style={styles.center}><ActivityIndicator size="large"/><Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{t('preparing')}</Text></SafeAreaView>;

  if (!session) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark"/>
        <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
          <View style={[styles.rowBetween, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}><Text style={[styles.title, { textAlign: isRtl ? 'right' : 'left' }]}>{t('appTitle')}</Text><Action title={t('language')} secondary onPress={changeLanguage} /></View>
          <Text style={[styles.subtitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('loginSubtitle')}</Text>
          <TextInput style={[styles.input, { textAlign: isRtl ? 'right' : 'left', writingDirection: isRtl ? 'rtl' : 'ltr' }]} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder={t('email')} editable={!busy}/>
          <TextInput style={[styles.input, { textAlign: isRtl ? 'right' : 'left', writingDirection: isRtl ? 'rtl' : 'ltr' }]} value={password} onChangeText={setPassword} secureTextEntry placeholder={t('password')} editable={!busy}/>
          <Action title={busy ? t('verifying') : t('login')} onPress={handleLogin} disabled={busy || !email.trim() || !password}/>
          {!!notice && <Text style={[styles.notice, { textAlign: isRtl ? 'right' : 'left' }]}>{notice}</Text>}
          {!!previousSession && <Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{t('oldAccountLabel')} {previousSession.user.email}. {t('useSame')}</Text>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark"/>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View><Text style={[styles.title, { textAlign: isRtl ? 'right' : 'left' }]}>{t('orders')}</Text><Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{session.user.email}</Text></View>
          <View style={[styles.inlineActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}><Action title={t('language')} secondary onPress={changeLanguage} /><Action title={t('logout')} secondary onPress={handleLogout} disabled={busy}/></View>
        </View>
        <View style={styles.queueCard}>
          <Text style={[styles.sectionTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('sync')}</Text>
          <Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{t('pending')} {pendingCount}</Text>
          <Action title={busy ? t('syncing') : t('syncNow')} onPress={syncQueue} disabled={busy}/>
          {queue.slice(0, 5).map(row => (
            <Text key={row.local_id} style={[styles.queueLine, { textAlign: isRtl ? 'right' : 'left' }]}>{row.status === 'synced' ? t('sent') : row.status === 'failed' ? t('failed') : row.status === 'syncing' ? t('sending') : t('waiting')} · {row.local_id.slice(0, 8)}</Text>
          ))}
        </View>
        <View style={[styles.rowBetween, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}><Text style={[styles.sectionTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('serviceArea')}</Text><Action title={t('refreshCatalog')} secondary onPress={() => refreshCatalog(session)} disabled={busy}/></View>
        {catalog?.stale && <Text style={[styles.warning, { textAlign: isRtl ? 'right' : 'left' }]}>{t('stale')}</Text>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {(catalog?.serviceAreas || []).map(area => <TouchableOpacity key={area.id} onPress={() => { setSelectedAreaId(area.id); setSelectedTableId(''); }} style={[styles.chip, selectedAreaId === area.id && styles.chipSelected]}><Text style={selectedAreaId === area.id ? styles.chipTextSelected : styles.chipText}>{area.name}</Text></TouchableOpacity>)}
        </ScrollView>
        <Text style={[styles.sectionTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('chooseTable')}</Text>
        <View style={styles.tableGrid}>
          {areaTables.map(table => <TouchableOpacity key={table.id} onPress={() => setSelectedTableId(table.id)} style={[styles.table, selectedTableId === table.id && styles.tableSelected]}><Text style={styles.tableName}>{table.tableName}</Text><Text style={[styles.mutedSmall, { textAlign: isRtl ? 'right' : 'left' }]}>{table.status === 'occupied' ? t('occupied') : table.status === 'reserved' ? t('reserved') : t('available')}</Text></TouchableOpacity>)}
        </View>
        <Text style={[styles.sectionTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('menu')}</Text>
        {activeItems.map(item => <View key={item.id} style={[styles.itemRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={[styles.itemInfo, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}><Text style={[styles.itemName, { textAlign: isRtl ? 'right' : 'left' }]}>{item.name}</Text><Text style={[styles.mutedSmall, { textAlign: isRtl ? 'right' : 'left' }]}>{item.price} {catalog?.restaurant.currency} · {item.routingGroup === 'bar' ? t('bar') : item.routingGroup === 'other' ? t('other') : t('kitchen')}</Text></View>
          <Action title={cart[item.id] ? `+ ${cart[item.id].quantity}` : t('add')} onPress={() => setCart(current => ({ ...current, [item.id]: { item, quantity: (current[item.id]?.quantity || 0) + 1 } }))}/>
        </View>)}
        <View style={styles.cartCard}>
          <Text style={[styles.sectionTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{t('cart')}</Text>
          {cartEntries.length === 0 ? <Text style={[styles.muted, { textAlign: isRtl ? 'right' : 'left' }]}>{t('emptyCart')}</Text> : cartEntries.map(entry => <View key={entry.item.id} style={[styles.cartLine, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.itemName, { textAlign: isRtl ? 'right' : 'left' }]}>{entry.item.name} × {entry.quantity}</Text>
            <View style={styles.inlineActions}><Action title="−" secondary onPress={() => setCart(current => { const next = { ...current }; if (next[entry.item.id].quantity <= 1) delete next[entry.item.id]; else next[entry.item.id] = { ...next[entry.item.id], quantity: next[entry.item.id].quantity - 1 }; return next; })}/><Action title="+" secondary onPress={() => setCart(current => ({ ...current, [entry.item.id]: { item: entry.item, quantity: entry.quantity + 1 } }))}/></View>
          </View>)}
          <Text style={[styles.total, { textAlign: isRtl ? 'right' : 'left' }]}>{t('estimated')} {moneyLabel(cartTotal, catalog?.restaurant.currency || '')}</Text>
          <Text style={[styles.mutedSmall, { textAlign: isRtl ? 'right' : 'left' }]}>{t('serverValidation')}</Text>
          <Action title={t('saveSend')} onPress={submitOrder} disabled={busy || !selectedTableId || cartEntries.length === 0}/>
        </View>
        {!!notice && <Text style={[styles.notice, { textAlign: isRtl ? 'right' : 'left' }]}>{notice}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f4f6f8' },
  loginContainer: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#18212b', textAlign: 'right' },
  subtitle: { fontSize: 16, color: '#596675', textAlign: 'right' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#243142', textAlign: 'right' },
  muted: { color: '#647282', textAlign: 'right', lineHeight: 21 },
  mutedSmall: { color: '#718091', fontSize: 12, textAlign: 'right' },
  input: { borderWidth: 1, borderColor: '#d3dbe3', borderRadius: 10, padding: 14, backgroundColor: '#fff', textAlign: 'right', writingDirection: 'rtl', fontSize: 16 },
  action: { backgroundColor: '#174f78', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  actionText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondaryAction: { backgroundColor: '#e7edf2' },
  secondaryActionText: { color: '#2b4358' },
  disabled: { opacity: 0.45 },
  notice: { color: '#31536d', backgroundColor: '#e5eff6', padding: 12, borderRadius: 9, textAlign: 'right', lineHeight: 21 },
  warning: { color: '#815b14', backgroundColor: '#fff1cf', padding: 10, borderRadius: 8, textAlign: 'right', lineHeight: 20 },
  queueCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 9 },
  queueLine: { color: '#4e5d6c', textAlign: 'right', fontSize: 12 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#e5eaf0', borderRadius: 20 },
  chipSelected: { backgroundColor: '#174f78' },
  chipText: { color: '#354557' },
  chipTextSelected: { color: '#fff', fontWeight: '700' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  table: { width: '23%', minWidth: 72, backgroundColor: '#fff', borderColor: '#d8e0e7', borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  tableSelected: { borderColor: '#174f78', borderWidth: 2, backgroundColor: '#e8f2f8' },
  tableName: { fontSize: 16, fontWeight: '700', color: '#263747' },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 12, gap: 10 },
  itemInfo: { flex: 1, gap: 4 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#263747', textAlign: 'right' },
  cartCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12 },
  cartLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inlineActions: { flexDirection: 'row', gap: 6 },
  total: { fontSize: 17, fontWeight: '800', color: '#174f78', textAlign: 'right' }
});
