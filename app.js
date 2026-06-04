var SUPABASE_URL = 'https://gtznlfzjcqbbrtzftmyp.supabase.co';
var SUPABASE_KEY = 'sb_publishable_FGc8tmPt5hdTALGqgTo0mw_F_rVPzv1';
var client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// =====================
// ⏱ FUSEAU HORAIRE
// Toute l'affichage est en UTC+3 (Madagascar).
// Le stockage reste en UTC — ne PAS modifier les appels toISOString().
// =====================
var APP_TIMEZONE = 'Indian/Antananarivo'; // UTC+3

// =====================
// CONFIG
// =====================
var PAGE_SIZE = 10;
var driversState    = { page: 0, total: 0, search: '' };
var shiftsState     = { page: 0, total: 0 };
var modalDriver     = null;
var modalShifts     = [];
var _selectedPeriod = 'all';
var currentUserRole = 'admin';
var statusColumnExists = true;

// =================================================================
// HELPERS FUSEAU HORAIRE (centralisés)
// =================================================================

/**
 * Formate une date en JJ/MM/AAAA (heure locale Madagascar UTC+3).
 * @param {string|Date} d  — valeur ISO ou objet Date
 */
function formatDate(d) {
  if (!d) return '—';
  var dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('fr-FR', {
    timeZone: APP_TIMEZONE,
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric'
  });
}

/**
 * Formate une heure en HH:MM (heure locale Madagascar UTC+3).
 * @param {string|Date} d
 */
function formatTime(d) {
  if (!d) return '—';
  var dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleTimeString('fr-FR', {
    timeZone: APP_TIMEZONE,
    hour:   '2-digit',
    minute: '2-digit'
  });
}

/**
 * Formate une date+heure complète (Madagascar UTC+3).
 * Utilisé pour les horodatages de rapports et les notifications.
 * @param {string|Date} d
 */
function formatDateTime(d) {
  if (!d) return '—';
  var dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleString('fr-FR', {
    timeZone: APP_TIMEZONE,
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit'
  });
}

/**
 * Retourne la date locale Madagascar au format YYYY-MM-DD.
 * À utiliser pour les noms de fichiers et comparaisons de dates.
 * NE PAS utiliser new Date().toISOString().slice(0,10) pour les noms de fichiers.
 */
function getLocalFileDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit'
  }).format(new Date()); // → 'YYYY-MM-DD' en heure Madagascar
}

/**
 * Retourne la date d'aujourd'hui en heure Madagascar (YYYY-MM-DD).
 * Utilisé pour comparer avec les dates d'expiration stockées en base.
 */
function getTodayStr() {
  return getLocalFileDate();
}

/**
 * Retourne la date dans N jours en heure Madagascar (YYYY-MM-DD).
 * @param {number} days
 */
function getFutureDateStr(days) {
  var future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit'
  }).format(future);
}

// Durée en heures/minutes (pas de fuseau, c'est une différence)
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '—';
  var m   = Math.round(ms / 60000);
  var h   = Math.floor(m / 60);
  var min = m % 60;
  return h > 0 ? h + 'h' + (min < 10 ? '0' : '') + min : m + ' min';
}

// Échappement HTML (sécurité XSS)
function escHtml(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

// =================================================================
// AUTH INIT
// =================================================================
(function () {
  client.auth.getSession().then(function (r) {
    if (r.data.session) loadProfile().then(showApp);
  });

  document.getElementById('loginPassword').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') login();
  });

  document.getElementById('modalOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });
})();

// =================================================================
// PROFIL / RÔLE
// =================================================================
function loadProfile() {
  return client.auth.getUser().then(function (r) {
    var user = r.data.user;
    if (!user) return;
    return client.from('profiles').select('role').eq('id', user.id).maybeSingle()
      .then(function (res) {
        currentUserRole = (!res.error && res.data && res.data.role) ? res.data.role : 'admin';
        applyRole(user);
      })
      .catch(function () { currentUserRole = 'admin'; applyRole(user); });
  });
}

function applyRole(user) {
  var el = document.getElementById('userInfo');
  if (el) el.textContent = (user ? user.email : '') + ' • ' + currentUserRole.toUpperCase();
  document.querySelectorAll('.admin-only').forEach(function (e) {
    if (currentUserRole === 'admin') e.classList.remove('hidden');
    else e.classList.add('hidden');
  });
}

// =================================================================
// SHOW APP / LOGIN
// =================================================================
function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');
  loadDashboard();
  loadDrivers(0);
  loadShifts(0);
  initSearch();
}

function showLogin() {
  document.getElementById('appPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('loginPassword').value = '';
}

// =================================================================
// LOGIN / LOGOUT
// =================================================================
function login() {
  var email    = document.getElementById('loginEmail').value.trim();
  var password = document.getElementById('loginPassword').value;
  if (!email || !password) { showToast('Email et mot de passe requis', 'error'); return; }

  var btn = document.querySelector('.login-submit');
  btn.textContent = 'Connexion...';
  btn.disabled = true;

  client.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
    btn.textContent = 'Se connecter';
    btn.disabled = false;
    if (r.error) { showToast(r.error.message, 'error'); return; }
    loadProfile().then(showApp);
  });
}

function logout() {
  client.auth.signOut().then(function () {
    driversState.search = '';
    driversState.page   = 0;
    shiftsState.page    = 0;
    showLogin();
  });
}

// =================================================================
// NAVIGATION
// =================================================================
function showSection(id, btn) {
  document.querySelectorAll('.section').forEach(function (s) { s.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (id === 'suspended') loadSuspendedDrivers();
}

// =================================================================
// TOAST
// =================================================================
function showToast(msg, type) {
  type = type || 'success';
  var t = document.getElementById('toast');
  t.className = 'toast show ' + type;
  t.innerText = msg;
  setTimeout(function () { t.className = 'toast'; }, 2800);
}

// =================================================================
// PAGINATION (générique)
// =================================================================
function renderPagination(containerId, page, total, cb) {
  var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  var c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = '';
  if (total === 0 || totalPages <= 1) return;

  var wrap = document.createElement('div');
  wrap.className = 'pagination-wrap';

  var info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = total + ' entrée' + (total > 1 ? 's' : '') + '  —  page ' + (page + 1) + ' / ' + totalPages;
  wrap.appendChild(info);

  var nav = document.createElement('div');
  nav.className = 'page-nav';

  function mkBtn(label, targetPage, isActive, isDisabled) {
    var b = document.createElement('button');
    b.className = 'page-btn' + (isActive ? ' page-active' : '');
    b.textContent = label;
    b.disabled = isDisabled;
    if (!isDisabled) {
      (function (p) { b.onclick = function () { cb(p); }; })(targetPage);
    }
    nav.appendChild(b);
  }

  mkBtn('←', page - 1, false, page === 0);
  var wStart = Math.max(0, Math.min(page - 2, totalPages - 5));
  var wEnd   = Math.min(totalPages - 1, wStart + 4);
  for (var i = wStart; i <= wEnd; i++) { mkBtn(i + 1, i, i === page, false); }
  mkBtn('→', page + 1, false, page >= totalPages - 1);

  wrap.appendChild(nav);
  c.appendChild(wrap);
}

// =================================================================
// DASHBOARD
// Comparaisons de dates en heure Madagascar (via getTodayStr/getFutureDateStr)
// =================================================================
function loadDashboard() {
  var q = statusColumnExists
    ? client.from('drivers').select('id, medical_expiration, status', { count: 'exact' })
    : client.from('drivers').select('id, medical_expiration',         { count: 'exact' });

  Promise.all([
    q,
    client.from('drivers').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
    client.from('shifts').select('id, status, driver_id',             { count: 'exact' })
  ]).then(function (results) {
    var driversRes = results[0];
    var suspRes    = results[1];
    var shiftsRes  = results[2];

    if (driversRes.error && statusColumnExists) {
      statusColumnExists = false;
      loadDashboard();
      return;
    }

    var drivers   = driversRes.data || [];
    var shifts    = shiftsRes.data  || [];
    var total     = driversRes.count || 0;
    var totalSusp = (!suspRes.error && suspRes.count) ? suspRes.count : 0;

    // ── Comparaison en heure locale Madagascar (YYYY-MM-DD string compare) ──
    var todayStr = getTodayStr();             // ex. '2026-06-03'
    var in30Str  = getFutureDateStr(30);      // ex. '2026-07-03'

    var medExp = 0, medSoon = 0;
    drivers.forEach(function (d) {
      if (!d.medical_expiration) return;
      // Comparaison de strings ISO — fonctionne car format YYYY-MM-DD
      if (d.medical_expiration <  todayStr) medExp++;
      else if (d.medical_expiration <= in30Str)  medSoon++;
    });

    var activeIds = {};
    shifts.forEach(function (s) {
      if (s.status === 'ACTIVE') activeIds[s.driver_id] = true;
    });
    var onShift = Object.keys(activeIds).length;

    function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
    set('kpiTotalDrivers', total);
    set('kpiOnShift',      onShift);
    set('kpiOffShift',     Math.max(0, total - onShift));
    set('kpiMedExpired',   medExp);
    set('kpiMedSoon',      medSoon);
    set('kpiTotalShifts',  shiftsRes.count || 0);
    set('kpiSuspended',    totalSusp);
  }).catch(function (e) { console.error('dashboard:', e); });
}

// =================================================================
// RECHERCHE — DRIVERS
// =================================================================
var _searchTimer = null;

function initSearch() {
  var input    = document.getElementById('driverSearch');
  var clearBtn = document.getElementById('clearSearch');
  if (!input) return;

  input.addEventListener('input', function () {
    clearTimeout(_searchTimer);
    var val = this.value;
    if (clearBtn) clearBtn.classList.toggle('hidden', !val.trim());
    _searchTimer = setTimeout(function () {
      driversState.search = val.trim();
      loadDrivers(0);
    }, 400);
  });
}

function handleSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function () {
    driversState.search = document.getElementById('driverSearch').value.trim();
    loadDrivers(0);
  }, 400);
}

function clearSearch() {
  var input    = document.getElementById('driverSearch');
  var clearBtn = document.getElementById('clearSearch');
  input.value = '';
  if (clearBtn) clearBtn.classList.add('hidden');
  driversState.search = '';
  loadDrivers(0);
  input.focus();
}

// =================================================================
// LOAD DRIVERS — paginé + recherche
// =================================================================
function loadDrivers(page) {
  if (page === undefined) page = 0;
  driversState.page = page;
  _buildDriverQuery(page, statusColumnExists).then(function (result) {
    if (result.error) {
      if (statusColumnExists) {
        statusColumnExists = false;
        showToast('⚠️ Colonne "status" absente — affichage de tous les chauffeurs', 'error');
        return _buildDriverQuery(page, false).then(renderDriverTable);
      }
      console.error('loadDrivers:', result.error);
      return;
    }
    renderDriverTable(result);
  });
}

function _buildDriverQuery(page, withStatus) {
  var from = page * PAGE_SIZE;
  var to   = from + PAGE_SIZE - 1;
  var q    = client.from('drivers').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (withStatus) q = q.neq('status', 'suspended');
  if (driversState.search) {
    var s = driversState.search.replace(/[%_\\]/g, '\\$&');
    q = q.or('full_name.ilike.%' + s + '%,phone.ilike.%' + s + '%,matricule.ilike.%' + s + '%');
  }
  return q.range(from, to);
}

function renderDriverTable(result) {
  var data  = result.data  || [];
  var count = result.count || 0;
  driversState.total = count;

  var el = document.getElementById('driversCount');
  if (el) el.textContent = count + ' chauffeur' + (count > 1 ? 's' : '');

  var tbody = document.getElementById('driverTable');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucun chauffeur trouvé</td></tr>';
    renderPagination('driversPagination', driversState.page, count, loadDrivers);
    return;
  }

  var ids = data.map(function (d) { return d.id; });
  client.from('shifts').select('id, driver_id')
    .eq('status', 'ACTIVE').in('driver_id', ids).is('shift_end', null)
    .then(function (sr) {
      var activeMap = {};
      (sr.data || []).forEach(function (s) { activeMap[s.driver_id] = s; });

      var isAdmin  = currentUserRole === 'admin';
      // ── Date locale Madagascar pour comparer les expirations ──
      var todayStr = getTodayStr();

      data.forEach(function (driver) {
        var active   = activeMap[driver.id];
        // Comparaison YYYY-MM-DD string (robuste au fuseau horaire)
        var expired  = driver.medical_expiration && driver.medical_expiration < todayStr;
        var canStart = !active && !expired;
        var canEnd   = !!active;

        var sid   = escHtml(driver.id);
        var smed  = escHtml(driver.medical_expiration);
        var sname = escHtml(driver.full_name).replace(/'/g, "\\'");

        var startBtn = canStart
          ? '<button onclick="startShift(\'' + sid + '\',\'' + smed + '\')">▶ Start</button>'
          : '<button disabled>▶ Start</button>';
        var endBtn = canEnd
          ? '<button onclick="endShift(\'' + sid + '\')">■ End</button>'
          : '<button disabled>■ End</button>';
        var ficheBtn = '<button class="btn-fiche" onclick="openDriverModal(\'' + sid + '\')">📄 Fiche</button>';
        var medBtn   = isAdmin ? '<button onclick="updateMedical(\'' + sid + '\')">🗓 Médical</button>' : '';
        var suspBtn  = isAdmin
          ? '<button class="icon-btn icon-suspend" title="Suspendre" onclick="suspendDriver(\'' + sid + '\',\'' + sname + '\')">⏸</button>'
          : '';
        var delBtn   = isAdmin
          ? '<button class="icon-btn icon-delete" title="Supprimer" onclick="deleteDriver(\'' + sid + '\',\'' + sname + '\')">🗑</button>'
          : '';

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + escHtml(driver.full_name) + '</strong></td>' +
          '<td>' + escHtml(driver.phone || '—') + '</td>' +
          '<td>' + escHtml(driver.matricule || '—') + '</td>' +
          '<td class="' + (expired ? 'expired' : '') + '">' + escHtml(driver.medical_expiration) + '</td>' +
          '<td><span class="badge ' + (active ? 'badge-on' : 'badge-off') + '">' +
            (active ? 'ON SHIFT' : 'OFF SHIFT') +
          '</span></td>' +
          '<td class="actions-cell">' + startBtn + endBtn + ficheBtn + medBtn + suspBtn + delBtn + '</td>';
        tbody.appendChild(tr);
      });

      renderPagination('driversPagination', driversState.page, count, loadDrivers);
    });
}

// =================================================================
// ADD DRIVER
// =================================================================
function addDriver() {
  var full_name          = document.getElementById('name').value.trim();
  var phone              = document.getElementById('phone').value.trim();
  var matricule          = document.getElementById('matricule').value.trim();
  var medical_expiration = document.getElementById('medical').value;

  if (!full_name || !medical_expiration) {
    showToast('Nom et date médicale obligatoires', 'error'); return;
  }
  if (!matricule) { showToast('Matricule obligatoire', 'error'); return; }

  var payload = {
    full_name:          full_name,
    phone:              phone,
    matricule:          matricule,
    medical_expiration: medical_expiration
  };
  if (statusColumnExists) payload.status = 'active';

  client.from('drivers').insert([payload]).then(function (r) {
    if (r.error) {
      if (r.error.message && r.error.message.includes('status')) {
        statusColumnExists = false;
        delete payload.status;
        client.from('drivers').insert([payload]).then(function (r2) {
          if (r2.error) { showToast(r2.error.message, 'error'); return; }
          afterAddDriver();
        });
      } else if (r.error.message && r.error.message.includes('unique_matricule')) {
        showToast('Matricule déjà utilisé', 'error');
      } else {
        showToast(r.error.message, 'error');
      }
      return;
    }
    afterAddDriver();
  });
}

function afterAddDriver() {
  showToast('Chauffeur ajouté ✓', 'success');
  ['name', 'phone', 'matricule', 'medical'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
  loadDrivers(0);
  loadDashboard();
}

// =================================================================
// SHIFTS — start / end
// Stockage : UTC (new Date().toISOString() — inchangé)
// Comparaison expiration : heure locale Madagascar
// =================================================================
function getActiveShift(driverId) {
  return client.from('shifts').select('*')
    .eq('driver_id', driverId).is('shift_end', null).maybeSingle()
    .then(function (r) { return r.data; });
}

function startShift(driverId, medicalExpiration) {
  // Comparaison YYYY-MM-DD en heure locale Madagascar
  if (medicalExpiration && medicalExpiration < getTodayStr()) {
    showToast('Certificat médical expiré', 'error'); return;
  }
  getActiveShift(driverId).then(function (a) {
    if (a) { showToast('Chauffeur déjà en service', 'error'); return; }
    client.from('shifts').insert([{
      driver_id:   driverId,
      shift_start: new Date().toISOString(), // ← stocké en UTC, inchangé
      status:      'ACTIVE'
    }]).then(function (r) {
      if (r.error) { showToast(r.error.message, 'error'); return; }
      showToast('Shift démarré ✓', 'success');
      loadDrivers(driversState.page); loadShifts(0); loadDashboard();
    });
  });
}

function endShift(driverId) {
  getActiveShift(driverId).then(function (a) {
    if (!a) { showToast('Aucun shift actif', 'error'); return; }
    client.from('shifts').update({
      shift_end: new Date().toISOString(), // ← stocké en UTC, inchangé
      status:    'ENDED'
    }).eq('id', a.id).then(function (r) {
      if (r.error) { showToast(r.error.message, 'error'); return; }
      showToast('Shift terminé ✓', 'success');
      loadDrivers(driversState.page); loadShifts(0); loadDashboard();
    });
  });
}

// =================================================================
// MODAL MÉDICAL (custom)
// =================================================================
var _medicalDriverId = null;
var _medicalOldDate  = null;

function updateMedical(driverId) {
  client.from('drivers').select('full_name, medical_expiration').eq('id', driverId).single()
    .then(function (r) {
      if (r.error || !r.data) { showToast('Erreur chargement', 'error'); return; }
      _medicalDriverId = driverId;
      _medicalOldDate  = r.data.medical_expiration;

      // Comparer avec la date locale Madagascar
      var expired = _medicalOldDate && _medicalOldDate < getTodayStr();

      document.getElementById('medicalModalTitle').textContent = 'Mise à jour médicale';
      document.getElementById('medicalModalSub').textContent   = r.data.full_name;

      var oldEl = document.getElementById('medicalOldDate');
      oldEl.textContent = _medicalOldDate || '—';
      oldEl.className   = 'mini-modal-old-date' + (expired ? ' old-date-expired' : ' old-date-ok');

      document.getElementById('medicalNewDate').value = _medicalOldDate || '';
      document.getElementById('medicalOverlay').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      setTimeout(function () { document.getElementById('medicalNewDate').focus(); }, 80);
    });
}

function closeMedicalModal() {
  document.getElementById('medicalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  _medicalDriverId = null;
  _medicalOldDate  = null;
}

function confirmMedical() {
  var newDate = document.getElementById('medicalNewDate').value;
  if (!newDate) { showToast('Veuillez sélectionner une date', 'error'); return; }
  if (!_medicalDriverId) return;

  var btn = document.querySelector('.mini-modal-confirm');
  btn.textContent = '...';
  btn.disabled    = true;

  client.from('drivers').update({ medical_expiration: newDate }).eq('id', _medicalDriverId)
    .then(function (r) {
      btn.textContent = '✓ Confirmer';
      btn.disabled    = false;
      if (r.error) { showToast(r.error.message, 'error'); return; }
      showToast('Date médicale mise à jour ✓', 'success');
      closeMedicalModal();
      loadDrivers(driversState.page);
      loadDashboard();
    });
}

// =================================================================
// SUSPENDRE / RÉACTIVER / SUPPRIMER
// =================================================================
function suspendDriver(driverId, driverName) {
  if (currentUserRole !== 'admin') { showToast('Admin seulement', 'error'); return; }
  getActiveShift(driverId).then(function (a) {
    if (a) { showToast('Terminez le shift avant de suspendre', 'error'); return; }
    if (!confirm('Suspendre "' + driverName + '" ?')) return;
    client.from('drivers').update({ status: 'suspended' }).eq('id', driverId).then(function (r) {
      if (r.error) { showToast(r.error.message, 'error'); return; }
      showToast('Chauffeur suspendu', 'success');
      loadDrivers(driversState.page); loadDashboard();
    });
  });
}

function reactivateDriver(driverId, driverName) {
  if (!confirm('Réactiver "' + driverName + '" ?')) return;
  client.from('drivers').update({ status: 'active' }).eq('id', driverId).then(function (r) {
    if (r.error) { showToast(r.error.message, 'error'); return; }
    showToast('Chauffeur réactivé ✓', 'success');
    loadSuspendedDrivers(); loadDrivers(0); loadDashboard();
  });
}

function deleteDriver(driverId, driverName) {
  if (currentUserRole !== 'admin') { showToast('Admin seulement', 'error'); return; }
  getActiveShift(driverId).then(function (a) {
    if (a) { showToast('Terminez le shift avant de supprimer', 'error'); return; }
    var rep = prompt('Tapez SUPPRIMER pour confirmer la suppression de "' + driverName + '"');
    if (rep !== 'SUPPRIMER') { showToast('Suppression annulée', 'error'); return; }
    client.from('shifts').delete().eq('driver_id', driverId).then(function () {
      client.from('drivers').delete().eq('id', driverId).then(function (r) {
        if (r.error) { showToast(r.error.message, 'error'); return; }
        showToast('Chauffeur supprimé définitivement', 'success');
        loadDrivers(driversState.page); loadDashboard();
      });
    });
  });
}

// =================================================================
// CHAUFFEURS SUSPENDUS
// =================================================================
function loadSuspendedDrivers() {
  client.from('drivers').select('*').eq('status', 'suspended')
    .order('created_at', { ascending: false })
    .then(function (r) {
      var data = r.data || [];
      var el   = document.getElementById('suspendedCount');
      if (el) el.textContent = data.length + ' suspendu' + (data.length > 1 ? 's' : '');

      var tbody = document.getElementById('suspendedTable');
      tbody.innerHTML = '';

      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucun chauffeur suspendu</td></tr>';
        return;
      }
      var todayStr = getTodayStr();
      data.forEach(function (d) {
        var sid   = escHtml(d.id);
        var sname = escHtml(d.full_name).replace(/'/g, "\\'");
        // Comparaison en heure locale Madagascar
        var exp   = d.medical_expiration && d.medical_expiration < todayStr;
        var tr    = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + escHtml(d.full_name) + '</strong></td>' +
          '<td>' + escHtml(d.phone || '—') + '</td>' +
          '<td>' + escHtml(d.matricule || '—') + '</td>' +
          '<td class="' + (exp ? 'expired' : '') + '">' + escHtml(d.medical_expiration) + '</td>' +
          // formatDate() utilise APP_TIMEZONE
          '<td>' + formatDate(d.updated_at || d.created_at) + '</td>' +
          '<td><button style="background:rgba(61,220,151,0.15);color:#3ddc97;border:1px solid rgba(61,220,151,0.3);" ' +
            'onclick="reactivateDriver(\'' + sid + '\',\'' + sname + '\')">✓ Réactiver</button></td>';
        tbody.appendChild(tr);
      });
    });
}

// =================================================================
// MODAL — FICHE CHAUFFEUR
// Toutes les dates affichées passent par formatDate() / formatTime()
// qui utilisent APP_TIMEZONE (UTC+3 Madagascar)
// =================================================================
function openDriverModal(driverId) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  content.innerHTML = '<div class="modal-loading">⏳ Chargement de la fiche...</div>';
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  Promise.all([
    client.from('drivers').select('*').eq('id', driverId).single(),
    client.from('shifts').select('*').eq('driver_id', driverId).order('shift_start', { ascending: false })
  ]).then(function (res) {
    var driver = res[0].data;
    var shifts = res[1].data || [];
    if (res[0].error || !driver) {
      showToast('Erreur chargement fiche', 'error'); closeModal(); return;
    }

    modalDriver = driver;
    modalShifts = shifts;

    var activeShift = shifts.find(function (s) { return !s.shift_end; });
    var endedShifts = shifts.filter(function (s) { return !!s.shift_end; });
    // Comparaison en heure locale Madagascar
    var expired     = driver.medical_expiration && driver.medical_expiration < getTodayStr();

    var totalMin = endedShifts.reduce(function (acc, s) {
      return acc + (new Date(s.shift_end) - new Date(s.shift_start)) / 60000;
    }, 0);
    var avgMin  = endedShifts.length > 0 ? totalMin / endedShifts.length : 0;
    var maxMs   = endedShifts.reduce(function (max, s) {
      var ms = new Date(s.shift_end) - new Date(s.shift_start);
      return ms > max ? ms : max;
    }, 0);
    var lastShift = endedShifts.length > 0 ? endedShifts[0] : null;

    // Lignes de tableau — formatDate/formatTime → APP_TIMEZONE
    var rows = shifts.length ? shifts.map(function (s) {
      var dur = s.shift_end
        ? Math.round((new Date(s.shift_end) - new Date(s.shift_start)) / 60000) + ' min'
        : '—';
      return '<tr>' +
        '<td>' + formatDate(s.shift_start) + '</td>' +
        '<td>' + formatTime(s.shift_start) + '</td>' +
        '<td>' + (s.shift_end ? formatDate(s.shift_end) : '<span class="active">EN COURS</span>') + '</td>' +
        '<td>' + (s.shift_end ? formatTime(s.shift_end) : '—') + '</td>' +
        '<td>' + dur + '</td>' +
        '<td><span class="badge ' + (s.status === 'ACTIVE' ? 'badge-on' : 'badge-off') + '">' +
          escHtml(s.status) + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6" class="empty-row">Aucun shift enregistré</td></tr>';

    _selectedPeriod = 'all';

    content.innerHTML =
      '<div class="modal-header">' +
        '<div class="modal-title-block">' +
          '<h2>' + escHtml(driver.full_name) + '</h2>' +
          '<span class="modal-matricule">Matricule : ' + escHtml(driver.matricule || 'non renseigné') + '</span>' +
        '</div>' +
        '<div class="modal-header-actions">' +
          '<button class="btn-close" onclick="closeModal()">✕</button>' +
        '</div>' +
      '</div>' +

      '<div class="period-bar">' +
        '<span class="period-bar-label">📅 Période export :</span>' +
        '<div class="period-pills">' +
          '<button class="period-pill active" data-period="all"        onclick="selectPeriod(this)">Tout</button>' +
          '<button class="period-pill"         data-period="month"      onclick="selectPeriod(this)">Ce mois</button>' +
          '<button class="period-pill"         data-period="prev_month" onclick="selectPeriod(this)">Mois préc.</button>' +
          '<button class="period-pill"         data-period="year"       onclick="selectPeriod(this)">Cette année</button>' +
          '<button class="period-pill"         data-period="prev_year"  onclick="selectPeriod(this)">Année préc.</button>' +
        '</div>' +
        '<span class="period-count" id="periodShiftCount">' + shifts.length + ' shift' + (shifts.length > 1 ? 's' : '') + '</span>' +
        '<div class="period-download-btns">' +
          '<button class="primary period-dl-btn"  onclick="downloadDriverPDF()">📄 PDF</button>' +
          '<button class="btn-fiche period-dl-btn" onclick="downloadDriverExcel()">📊 Excel</button>' +
        '</div>' +
      '</div>' +

      '<div class="modal-stats">' +
        _stat(escHtml(driver.phone || '—'),        'Téléphone', '') +
        _stat(escHtml(driver.medical_expiration),  expired ? '⚠️ Expiré' : '✅ Valide', expired ? 'stat-danger' : 'stat-ok') +
        _stat(activeShift ? 'ON SHIFT' : 'OFF SHIFT', 'Statut', activeShift ? 'stat-on' : '') +
        _stat(shifts.length,                       'Total shifts', '') +
        _stat((totalMin / 60).toFixed(1) + 'h',    'Heures totales', '') +
        _stat((avgMin  / 60).toFixed(2) + 'h',     'Moy/shift', '') +
        _stat(maxMs > 0 ? formatDuration(maxMs) : '—', 'Plus long', '') +
        // formatDate() → APP_TIMEZONE
        _stat(lastShift ? formatDate(lastShift.shift_end) : '—', 'Dernier shift', '') +
      '</div>' +

      '<div class="modal-shifts-section">' +
        '<h3>Historique des shifts</h3>' +
        '<div class="modal-table-wrap">' +
          '<table>' +
            '<thead><tr>' +
              '<th>Date deb.</th><th>Heure deb.</th>' +
              '<th>Date fin</th><th>Heure fin</th>' +
              '<th>Durée</th><th>Statut</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  });
}

function _stat(val, lbl, cls) {
  return '<div class="stat-card ' + cls + '"><span class="stat-val">' + val +
    '</span><span class="stat-lbl">' + lbl + '</span></div>';
}

// =================================================================
// FILTRE DE PÉRIODE
// Les bornes sont calculées à partir de la date locale Madagascar
// =================================================================
function selectPeriod(btn) {
  _selectedPeriod = btn.getAttribute('data-period');
  document.querySelectorAll('.period-pill').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var filtered = filterShiftsByPeriod(modalShifts, _selectedPeriod);
  var el = document.getElementById('periodShiftCount');
  if (el) el.textContent = filtered.length + ' shift' + (filtered.length > 1 ? 's' : '');
}

function filterShiftsByPeriod(shifts, period) {
  if (period === 'all') return shifts;

  // On calcule les bornes de la période en heure locale Madagascar
  var todayStr = getTodayStr(); // 'YYYY-MM-DD'
  var parts    = todayStr.split('-');
  var y = parseInt(parts[0]);
  var m = parseInt(parts[1]); // 1-12
  var start, end;

  if (period === 'month') {
    start = y + '-' + _pad(m) + '-01';
    end   = y + '-' + _pad(m) + '-' + _pad(_lastDay(y, m));
  } else if (period === 'prev_month') {
    var pm = m === 1 ? 12 : m - 1;
    var py = m === 1 ? y - 1 : y;
    start  = py + '-' + _pad(pm) + '-01';
    end    = py + '-' + _pad(pm) + '-' + _pad(_lastDay(py, pm));
  } else if (period === 'year') {
    start = y + '-01-01';
    end   = y + '-12-31';
  } else if (period === 'prev_year') {
    start = (y - 1) + '-01-01';
    end   = (y - 1) + '-12-31';
  } else {
    return shifts;
  }

  return shifts.filter(function (s) {
    // On compare la date locale Madagascar du shift_start avec les bornes
    var shiftDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(s.shift_start));
    return shiftDateStr >= start && shiftDateStr <= end;
  });
}

function _pad(n)       { return String(n).padStart(2, '0'); }
function _lastDay(y,m) { return new Date(y, m, 0).getDate(); } // dernier jour du mois

function periodLabel() {
  return { all:'Tous les shifts', month:'Ce mois', prev_month:'Mois précédent',
           year:'Cette année',    prev_year:'Année précédente' }[_selectedPeriod] || 'Tous les shifts';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  modalDriver = null;
  modalShifts = [];
}

// =================================================================
// PDF — FICHE CHAUFFEUR
// Horodatage rapport → formatDateTime() (UTC+3 Madagascar)
// Nom de fichier   → getLocalFileDate() (pas toISOString)
// =================================================================
function downloadDriverPDF() {

var shifts = filterShiftsByPeriod(modalShifts, _selectedPeriod);
var jsPDF = window.jspdf.jsPDF;
var doc = new jsPDF();

var endedS = shifts.filter(function (s) {
  return s.shift_end;
});

// Total travaillé en heures + minutes
var totalMinutes = endedS.reduce(function (a, s) {
  return a + Math.round(
    (new Date(s.shift_end) - new Date(s.shift_start)) / 60000
  );
}, 0);

var totalHours = Math.floor(totalMinutes / 60);
var remainingMinutes = totalMinutes % 60;
var totalH = totalHours + 'h ' + remainingMinutes + 'min';

doc.setTextColor(0, 0, 0);

doc.autoTable({
  startY: 45,
  body: [
    ['Nom complet', driver.full_name],
    ['Téléphone', driver.phone || '—'],
    ['Matricule', driver.matricule || '—'],
    ['Expiration médicale', driver.medical_expiration],
    ['Période', periodLabel()],
    ['Shifts inclus', shifts.length],
    ['Heures travaillées', totalH]
  ],
  theme: 'plain',
  columnStyles: {
    0: { fontStyle: 'bold', cellWidth: 55 },
    1: { cellWidth: 100 }
  },
  styles: {
    fontSize: 10,
    cellPadding: 3
  }
});

var y = doc.lastAutoTable.finalY + 8;

doc.setFillColor(236, 169, 0);
doc.rect(14, y, 182, 12, 'F');

doc.setTextColor(8, 16, 40);
doc.setFontSize(9);

doc.text(
  'Rapport généré le ' +
    formatDateTime(new Date()) +
    '  —  ' +
    periodLabel(),
  19,
  y + 8
);

var rows = shifts.map(function (s) {

  var dur = '—';

  if (s.shift_end) {
    var shiftMinutes = Math.round(
      (new Date(s.shift_end) - new Date(s.shift_start)) / 60000
    );

    var hours = Math.floor(shiftMinutes / 60);
    var minutes = shiftMinutes % 60;

    dur = hours + 'h ' + minutes + 'min';
  }

  return [
    formatDate(s.shift_start),
    formatTime(s.shift_start),
    s.shift_end ? formatDate(s.shift_end) : 'EN COURS',
    s.shift_end ? formatTime(s.shift_end) : '—',
    dur,
    s.status
  ];
});

doc.autoTable({
  startY: y + 18,
  head: [['Date deb.', 'Heure deb.', 'Date fin', 'Heure fin', 'Durée', 'Statut']],
  body: rows.length
    ? rows
    : [['—', '—', '—', '—', '—', 'Aucun shift']],
  theme: 'striped',
  headStyles: {
    fillColor: [236, 169, 0],
    textColor: [8, 16, 40],
    fontStyle: 'bold'
  },
  styles: {
    fontSize: 8,
    cellPadding: 2
  }
});

// Nom de fichier avec date locale Madagascar
var safeName = driver.full_name
  .replace(/[^a-z0-9_\- ]/gi, '_')
  .trim();

doc.save(
  'fiche_' +
    safeName +
    '_' +
    periodLabel().replace(/\s+/g, '_') +
    '_' +
    getLocalFileDate() +
    '.pdf'
);

showToast('PDF téléchargé ✓', 'success');

// =================================================================
// EXCEL — FICHE CHAUFFEUR
// Dates affichées → formatDate/formatTime (UTC+3 Madagascar)
// Nom de fichier  → getLocalFileDate()
// =================================================================
function downloadDriverExcel() {
  var driver = modalDriver;
  if (!driver) return;
  var shifts  = filterShiftsByPeriod(modalShifts, _selectedPeriod);
  var wb      = XLSX.utils.book_new();
  var endedS  = shifts.filter(function (s) { return s.shift_end; });
  var totalH  = endedS.reduce(function (a, s) {
    return a + (new Date(s.shift_end) - new Date(s.shift_start)) / 3600000;
  }, 0).toFixed(1);

  var ws1 = XLSX.utils.json_to_sheet([
    { Champ: 'Nom complet',          Valeur: driver.full_name },
    { Champ: 'Téléphone',            Valeur: driver.phone || '' },
    { Champ: 'Matricule',            Valeur: driver.matricule || '' },
    { Champ: 'Expiration médicale',  Valeur: driver.medical_expiration },
    // formatDate → APP_TIMEZONE
    { Champ: 'Enregistré le',        Valeur: formatDate(driver.created_at) },
    { Champ: 'Période',              Valeur: periodLabel() },
    { Champ: 'Shifts inclus',        Valeur: shifts.length },
    { Champ: 'Heures travaillées',   Valeur: totalH + 'h' }
  ]);
  ws1['!cols'] = [{ wch: 26 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Informations');

  var rows = shifts.length ? shifts.map(function (s) {
    return {
      // formatDate / formatTime → APP_TIMEZONE
      'Date début':  formatDate(s.shift_start),
      'Heure début': formatTime(s.shift_start),
      'Date fin':    s.shift_end ? formatDate(s.shift_end)  : 'EN COURS',
      'Heure fin':   s.shift_end ? formatTime(s.shift_end)  : '',
      'Durée (min)': s.shift_end
        ? Math.round((new Date(s.shift_end) - new Date(s.shift_start)) / 60000)
        : '',
      'Statut': s.status
    };
  }) : [{ Info: 'Aucun shift pour cette période' }];

  var ws2 = XLSX.utils.json_to_sheet(rows);
  ws2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Shifts');

  var safeName = driver.full_name.replace(/[^a-z0-9_\- ]/gi, '_').trim();
  // ← Nom de fichier avec date locale Madagascar
  XLSX.writeFile(wb, 'fiche_' + safeName + '_' + periodLabel().replace(/\s+/g, '_') + '_' + getLocalFileDate() + '.xlsx');
  showToast('Excel téléchargé ✓', 'success');
}

// =================================================================
// LOAD SHIFTS — paginé, date/heure séparées (APP_TIMEZONE)
// =================================================================
function loadShifts(page) {
  if (page === undefined) page = 0;
  shiftsState.page = page;
  var from = page * PAGE_SIZE;
  var to   = from + PAGE_SIZE - 1;

  client.from('shifts')
    .select('*, drivers(full_name)', { count: 'exact' })
    .order('shift_start', { ascending: false })
    .range(from, to)
    .then(function (r) {
      if (r.error) { console.error('loadShifts:', r.error); return; }

      var data  = r.data  || [];
      var count = r.count || 0;
      shiftsState.total = count;

      var el = document.getElementById('shiftsCount');
      if (el) el.textContent = count + ' shift' + (count > 1 ? 's' : '');

      var tbody = document.getElementById('shiftTable');
      tbody.innerHTML = '';

      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Aucun shift enregistré</td></tr>';
      } else {
        data.forEach(function (shift) {
          
          var hasEnd = !!shift.shift_end;
          // formatDate / formatTime → APP_TIMEZONE (UTC+3)
          var dur = hasEnd ? formatDuration(new Date(shift.shift_end) - new Date(shift.shift_start)) : '—';

          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td><strong>' + escHtml(shift.drivers ? shift.drivers.full_name : '—') + '</strong></td>' +
            '<td>' + formatDate(shift.shift_start) + '</td>' +
            '<td>' + formatTime(shift.shift_start) + '</td>' +
            '<td>' + (hasEnd ? formatDate(shift.shift_end) : '<span class="active">EN COURS</span>') + '</td>' +
            '<td>' + (hasEnd ? formatTime(shift.shift_end) : '—') + '</td>' +
            '<td>' + dur + '</td>' +
            '<td><span class="badge ' + (shift.status === 'ACTIVE' ? 'badge-on' : 'badge-off') + '">' +
              escHtml(shift.status) + '</span></td>';
          tbody.appendChild(tr);
        });
      }
      renderPagination('shiftsPagination', page, count, loadShifts);
    });
}

// =================================================================
// EXPORT PDF — SHIFTS
// Horodatage  → formatDateTime() (UTC+3)
// Nom fichier → getLocalFileDate()
// =================================================================
function exportShiftsPDF() {
  var startDate = document.getElementById('startDate').value;
  var endDate   = document.getElementById('endDate').value;

  var q = client.from('shifts')
    .select('*, drivers(full_name, phone, matricule)')
    .order('shift_start', { ascending: false });
  if (startDate) q = q.gte('shift_start', startDate);
  if (endDate)   q = q.lte('shift_start', endDate + 'T23:59:59');

  q.then(function (r) {
    if (r.error) { showToast(r.error.message, 'error'); return; }
    if (!r.data || !r.data.length) { showToast('Aucune donnée', 'error'); return; }

    var jsPDF = window.jspdf.jsPDF;
    var doc   = new jsPDF({ orientation: 'landscape' });

    doc.setFillColor(8, 16, 40); doc.rect(0, 0, 297, 28, 'F');
    doc.setTextColor(236, 169, 0); doc.setFontSize(18);
    doc.text('RAPPORT DES SHIFTS', 148, 17, { align: 'center' });

    doc.setTextColor(8, 16, 40); doc.setFontSize(9);
    // ← formatDateTime() → heure locale Madagascar
    doc.text('Généré le ' + formatDateTime(new Date()), 14, 38);
    if (startDate || endDate) {
      doc.text('Période : ' + (startDate || 'début') + ' → ' + (endDate || "aujourd'hui"), 14, 44);
    }

    var rows = r.data.map(function (s) {
      var dur = s.shift_end
        ? Math.round((new Date(s.shift_end) - new Date(s.shift_start)) / 60000) + ' min'
        : '—';
      // formatDate / formatTime → APP_TIMEZONE
      return [
        s.drivers ? s.drivers.full_name  : '—',
        s.drivers ? (s.drivers.phone     || '') : '',
        s.drivers ? (s.drivers.matricule || '') : '',
        formatDate(s.shift_start), formatTime(s.shift_start),
        s.shift_end ? formatDate(s.shift_end) : 'EN COURS',
        s.shift_end ? formatTime(s.shift_end) : '—',
        dur, s.status
      ];
    });

    doc.autoTable({
      startY: 50,
      head: [['Chauffeur', 'Téléphone', 'Matricule',
              'Date deb.', 'Heure deb.', 'Date fin', 'Heure fin', 'Durée', 'Statut']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [236, 169, 0], textColor: [8, 16, 40], fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 2 }
    });

    // ← Nom de fichier : date locale Madagascar
    doc.save('shifts_' + getLocalFileDate() + '.pdf');
    showToast('PDF exporté ✓', 'success');
  });
}

// =================================================================
// EXPORT CSV — SHIFTS
// Dates affichées → formatDate/formatTime (UTC+3)
// Nom fichier     → getLocalFileDate()
// BOM UTF-8 + séparateur ";" (compatibilité Excel FR)
// =================================================================
function exportShiftsCSV() {
  var startDate = document.getElementById('startDate').value;
  var endDate   = document.getElementById('endDate').value;

  var q = client.from('shifts')
    .select('*, drivers(full_name, phone, matricule)')
    .order('shift_start', { ascending: false });
  if (startDate) q = q.gte('shift_start', startDate);
  if (endDate)   q = q.lte('shift_start', endDate + 'T23:59:59');

  q.then(function (r) {
    if (r.error)                      { showToast(r.error.message, 'error');          return; }
    if (!r.data || !r.data.length)    { showToast('Aucune donnée à exporter', 'error'); return; }

    var SEP  = ';';  // séparateur FR pour Excel
    var rows = [['Chauffeur', 'Téléphone', 'Matricule',
                 'Date début', 'Heure début', 'Date fin', 'Heure fin',
                 'Durée (min)', 'Statut']];

    r.data.forEach(function (s) {
      var durMin = s.shift_end
        ? Math.round((new Date(s.shift_end) - new Date(s.shift_start)) / 60000)
        : '';
      rows.push([
        s.drivers ? s.drivers.full_name   : '',
        s.drivers ? (s.drivers.phone      || '') : '',
        s.drivers ? (s.drivers.matricule  || '') : '',
        // formatDate / formatTime → APP_TIMEZONE
        formatDate(s.shift_start),
        formatTime(s.shift_start),
        s.shift_end ? formatDate(s.shift_end)  : 'EN COURS',
        s.shift_end ? formatTime(s.shift_end)  : '',
        durMin,
        s.status
      ]);
    });

    var csv = '\uFEFF' + rows.map(function (row) {  // BOM UTF-8
      return row.map(function (c) {
        var v = String(c == null ? '' : c);
        if (v.includes(SEP) || v.includes('"') || v.includes('\n')) {
          v = '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
      }).join(SEP);
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    // ← Nom de fichier : date locale Madagascar (pas toISOString)
    a.download = 'shifts_' + getLocalFileDate() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exporté ✓', 'success');
 
  });
}
