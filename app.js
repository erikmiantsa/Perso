// ============================================================
// DRIVER SHIFT MANAGEMENT — VERSION CORRIGÉE
// Fixes: status column, profiles table, pagination, modal, CSV
// ============================================================

var SUPABASE_URL = 'https://gtznlfzjcqbbrtzftmyp.supabase.co';
var SUPABASE_KEY = 'sb_publishable_FGc8tmPt5hdTALGqgTo0mw_F_rVPzv1';
var client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var PAGE_SIZE = 10;
var driversState = { page: 0, total: 0, search: '' };
var shiftsState  = { page: 0, total: 0 };
var modalDriver  = null;
var modalShifts  = [];
// Par défaut admin — sera mis à jour si la table profiles existe
var currentUserRole = 'admin';
// Flag pour savoir si la colonne status existe dans drivers
var statusColumnExists = true;

// =====================
// AUTH INIT
// =====================
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
})();

// =====================
// PROFIL / RÔLE
// (Si la table profiles n'existe pas → admin par défaut)
// =====================
function loadProfile() {
  return client.auth.getUser().then(function (r) {
    var user = r.data.user;
    if (!user) return;

    return client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(function (res) {
        // Que la table existe ou non, on applique le rôle
        if (!res.error && res.data && res.data.role) {
          currentUserRole = res.data.role;
        } else {
          // Profiles table absente ou pas de profil → admin par défaut
          currentUserRole = 'admin';
        }
        applyRole(user);
      })
      .catch(function () {
        currentUserRole = 'admin';
        applyRole(user);
      });
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

// =====================
// SHOW APP / LOGIN
// =====================
function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');
  loadDashboard();
  loadDrivers(0);
  loadShifts(0);
}

function showLogin() {
  document.getElementById('appPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
}

// =====================
// LOGIN / LOGOUT
// =====================
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
  client.auth.signOut().then(showLogin);
}

// =====================
// NAVIGATION
// =====================
function showSection(id, btn) {
  document.querySelectorAll('.section').forEach(function (s) { s.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (id === 'suspended') loadSuspendedDrivers();
}

// =====================
// TOAST
// =====================
function showToast(msg, type) {
  type = type || 'success';
  var t = document.getElementById('toast');
  t.className = 'toast show ' + type;
  t.innerText = msg;
  setTimeout(function () { t.className = 'toast'; }, 2800);
}

// =====================
// FORMATAGE DATES/DURÉE
// =====================
function formatDate(d) {
  if (!d) return '—';
  var dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('fr-FR');
}
function formatTime(d) {
  if (!d) return '—';
  var dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '—';
  var m = Math.round(ms / 60000);
  var h = Math.floor(m / 60);
  var min = m % 60;
  return h > 0 ? h + 'h' + (min < 10 ? '0' : '') + min : m + ' min';
}
function escHtml(t) {
  if (t == null) return '';
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// =====================
// PAGINATION (générique)
// =====================
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
  for (var i = wStart; i <= wEnd; i++) {
    mkBtn(i + 1, i, i === page, false);
  }

  mkBtn('→', page + 1, false, page >= totalPages - 1);

  wrap.appendChild(nav);
  c.appendChild(wrap);
}

// =====================
// DASHBOARD
// (résilient : si status manque, on compte tous les chauffeurs)
// =====================
function loadDashboard() {
  var q = statusColumnExists
    ? client.from('drivers').select('id, medical_expiration, status', { count: 'exact' })
    : client.from('drivers').select('id, medical_expiration', { count: 'exact' });

  Promise.all([
    q,
    client.from('drivers').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
    client.from('shifts').select('id, status, driver_id', { count: 'exact' })
  ]).then(function (results) {
    var driversRes  = results[0];
    var suspRes     = results[1];
    var shiftsRes   = results[2];

    // Si erreur sur status, on retente sans
    if (driversRes.error && statusColumnExists) {
      statusColumnExists = false;
      loadDashboard();
      return;
    }

    var drivers     = driversRes.data || [];
    var shifts      = shiftsRes.data || [];
    var total       = driversRes.count || 0;
    var totalSusp   = (!suspRes.error && suspRes.count) ? suspRes.count : 0;

    var now = new Date();
    var in30 = new Date(); in30.setDate(now.getDate() + 30);
    var medExp = 0, medSoon = 0;

    drivers.forEach(function (d) {
      if (!d.medical_expiration) return;
      var e = new Date(d.medical_expiration);
      if (e < now) medExp++;
      else if (e < in30) medSoon++;
    });

    var activeIds = {};
    shifts.forEach(function (s) {
      if (s.status === 'ACTIVE') activeIds[s.driver_id] = true;
    });
    var onShift = Object.keys(activeIds).length;

    set('kpiTotalDrivers', total);
    set('kpiOnShift',      onShift);
    set('kpiOffShift',     Math.max(0, total - onShift));
    set('kpiMedExpired',   medExp);
    set('kpiMedSoon',      medSoon);
    set('kpiTotalShifts',  shiftsRes.count || 0);
    set('kpiSuspended',    totalSusp);
  }).catch(function (e) { console.error('dashboard:', e); });

  function set(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }
}

// =====================
// RECHERCHE
// =====================
var _searchTimer = null;
function handleSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function () {
    driversState.search = document.getElementById('driverSearch').value.trim();
    loadDrivers(0);
  }, 400);
}
function clearSearch() {
  document.getElementById('driverSearch').value = '';
  driversState.search = '';
  loadDrivers(0);
}

// =====================
// LOAD DRIVERS
// — Résilient : si colonne status absente → retry sans filtre
// =====================
function loadDrivers(page) {
  if (page === undefined) page = 0;
  driversState.page = page;
  _buildDriverQuery(page, statusColumnExists).then(function (result) {
    if (result.error) {
      // Colonne status absente ?
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

  var q = client.from('drivers').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (withStatus) q = q.neq('status', 'suspended');

  if (driversState.search) {
    var s = driversState.search;
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

  // Récupère tous les shifts actifs en une seule requête (pas N+1)
  var ids = data.map(function (d) { return d.id; });
  client.from('shifts').select('id, driver_id')
    .eq('status', 'ACTIVE').in('driver_id', ids).is('shift_end', null)
    .then(function (sr) {
      var activeMap = {};
      (sr.data || []).forEach(function (s) { activeMap[s.driver_id] = s; });

      var isAdmin = currentUserRole === 'admin';
      var now = new Date();

      data.forEach(function (driver) {
        var active    = activeMap[driver.id];
        var expired   = driver.medical_expiration && new Date(driver.medical_expiration) < now;
        var canStart  = !active && !expired;
        var canEnd    = !!active;

        var sid  = escHtml(driver.id);
        var smed = escHtml(driver.medical_expiration);
        var sname = escHtml(driver.full_name).replace(/'/g, "\\'");

        var startBtn = canStart
          ? '<button onclick="startShift(\'' + sid + '\',\'' + smed + '\')">▶ Start</button>'
          : '<button disabled>▶ Start</button>';
        var endBtn = canEnd
          ? '<button onclick="endShift(\'' + sid + '\')">■ End</button>'
          : '<button disabled>■ End</button>';
        var ficheBtn   = '<button class="btn-fiche" onclick="openDriverModal(\'' + sid + '\')">📄 Fiche</button>';
        var medBtn     = isAdmin ? '<button onclick="updateMedical(\'' + sid + '\')">🗓 Médical</button>' : '';
        var suspBtn    = isAdmin
          ? '<button style="background:rgba(245,176,65,0.15);color:#f5b041;border:1px solid rgba(245,176,65,0.3);" onclick="suspendDriver(\'' + sid + '\',\'' + sname + '\')">⏸ Suspendre</button>'
          : '';
        var delBtn     = isAdmin
          ? '<button style="background:rgba(255,92,92,0.15);color:#ff5c5c;border:1px solid rgba(255,92,92,0.3);" onclick="deleteDriver(\'' + sid + '\',\'' + sname + '\')">🗑 Supprimer</button>'
          : '';

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + escHtml(driver.full_name) + '</strong></td>' +
          '<td>' + escHtml(driver.phone || '—') + '</td>' +
          '<td>' + escHtml(driver.matricule || '—') + '</td>' +
          '<td class="' + (expired ? 'expired' : '') + '">' + escHtml(driver.medical_expiration) + '</td>' +
          '<td><span class="badge ' + (active ? 'badge-on' : 'badge-off') + '">' + (active ? 'ON SHIFT' : 'OFF SHIFT') + '</span></td>' +
          '<td class="actions-cell">' + startBtn + endBtn + ficheBtn + medBtn + suspBtn + delBtn + '</td>';
        tbody.appendChild(tr);
      });

      renderPagination('driversPagination', driversState.page, count, loadDrivers);
    });
}

// =====================
// ADD DRIVER
// =====================
function addDriver() {
  var full_name          = document.getElementById('name').value.trim();
  var phone              = document.getElementById('phone').value.trim();
  var matricule          = document.getElementById('matricule').value.trim();
  var medical_expiration = document.getElementById('medical').value;

  if (!full_name || !medical_expiration) {
    showToast('Nom et date médicale obligatoires', 'error'); return;
  }
  if (!matricule) {
    showToast('Matricule obligatoire', 'error'); return;
  }

  var payload = { full_name: full_name, phone: phone, matricule: matricule, medical_expiration: medical_expiration };
  if (statusColumnExists) payload.status = 'active';

  client.from('drivers').insert([payload]).then(function (r) {
    if (r.error) {
      if (r.error.message && r.error.message.includes('status')) {
        // Colonne status absente, réessai sans
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
  ['name','phone','matricule','medical'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
  loadDrivers(0);
  loadDashboard();
}

// =====================
// SHIFTS
// =====================
function getActiveShift(driverId) {
  return client.from('shifts').select('*')
    .eq('driver_id', driverId).is('shift_end', null).maybeSingle()
    .then(function (r) { return r.data; });
}

function startShift(driverId, medicalExpiration) {
  if (medicalExpiration && new Date(medicalExpiration) < new Date()) {
    showToast('Certificat médical expiré', 'error'); return;
  }
  getActiveShift(driverId).then(function (a) {
    if (a) { showToast('Chauffeur déjà en service', 'error'); return; }
    client.from('shifts').insert([{
      driver_id: driverId, shift_start: new Date().toISOString(), status: 'ACTIVE'
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
    client.from('shifts').update({ shift_end: new Date().toISOString(), status: 'ENDED' })
      .eq('id', a.id).then(function (r) {
        if (r.error) { showToast(r.error.message, 'error'); return; }
        showToast('Shift terminé ✓', 'success');
        loadDrivers(driversState.page); loadShifts(0); loadDashboard();
      });
  });
}

// =====================
// MÉDICAL — modal custom
// =====================
var _medicalDriverId  = null;
var _medicalOldDate   = null;

function updateMedical(driverId) {
  // Récupère les infos du driver pour pré-remplir le modal
  client.from('drivers').select('full_name, medical_expiration').eq('id', driverId).single()
    .then(function (r) {
      if (r.error || !r.data) { showToast('Erreur chargement', 'error'); return; }
      _medicalDriverId = driverId;
      _medicalOldDate  = r.data.medical_expiration;

      var expired = _medicalOldDate && new Date(_medicalOldDate) < new Date();

      document.getElementById('medicalModalTitle').textContent = 'Mise à jour médicale';
      document.getElementById('medicalModalSub').textContent   = r.data.full_name;

      var oldEl = document.getElementById('medicalOldDate');
      oldEl.textContent  = _medicalOldDate || '—';
      oldEl.className    = 'mini-modal-old-date' + (expired ? ' old-date-expired' : ' old-date-ok');

      // Pré-remplir avec la date actuelle
      document.getElementById('medicalNewDate').value = _medicalOldDate || '';

      document.getElementById('medicalOverlay').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      // Focus sur le champ date
      setTimeout(function () {
        document.getElementById('medicalNewDate').focus();
      }, 80);
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

// =====================
// SUSPENDRE / RÉACTIVER / SUPPRIMER
// =====================
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

// =====================
// CHAUFFEURS SUSPENDUS
// =====================
function loadSuspendedDrivers() {
  client.from('drivers').select('*').eq('status', 'suspended')
    .order('created_at', { ascending: false })
    .then(function (r) {
      var data  = r.data || [];
      var el    = document.getElementById('suspendedCount');
      if (el) el.textContent = data.length + ' suspendu' + (data.length > 1 ? 's' : '');

      var tbody = document.getElementById('suspendedTable');
      tbody.innerHTML = '';

      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Aucun chauffeur suspendu</td></tr>';
        return;
      }
      data.forEach(function (d) {
        var sid   = escHtml(d.id);
        var sname = escHtml(d.full_name).replace(/'/g, "\\'");
        var exp   = d.medical_expiration && new Date(d.medical_expiration) < new Date();
        var tr    = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + escHtml(d.full_name) + '</strong></td>' +
          '<td>' + escHtml(d.phone || '—') + '</td>' +
          '<td>' + escHtml(d.matricule || '—') + '</td>' +
          '<td class="' + (exp ? 'expired' : '') + '">' + escHtml(d.medical_expiration) + '</td>' +
          '<td>' + formatDate(d.updated_at || d.created_at) + '</td>' +
          '<td><button style="background:rgba(61,220,151,0.15);color:#3ddc97;border:1px solid rgba(61,220,151,0.3);" onclick="reactivateDriver(\'' + sid + '\',\'' + sname + '\')">✓ Réactiver</button></td>';
        tbody.appendChild(tr);
      });
    });
}

// =====================
// MODAL — FICHE CHAUFFEUR
// =====================
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
    if (res[0].error) { showToast('Erreur chargement fiche', 'error'); closeModal(); return; }

    modalDriver = driver;
    modalShifts = shifts;

    var activeShift  = shifts.find(function (s) { return !s.shift_end; });
    var endedShifts  = shifts.filter(function (s) { return !!s.shift_end; });
    var expired      = driver.medical_expiration && new Date(driver.medical_expiration) < new Date();

    var totalMin = endedShifts.reduce(function (acc, s) {
      return acc + (new Date(s.shift_end) - new Date(s.shift_start)) / 60000;
    }, 0);

    var avgMin  = endedShifts.length > 0 ? totalMin / endedShifts.length : 0;
    var maxMs   = endedShifts.reduce(function (max, s) {
      var ms = new Date(s.shift_end) - new Date(s.shift_start);
      return ms > max ? ms : max;
    }, 0);

    var lastShift = endedShifts.length > 0 ? endedShifts[0] : null; // déjà trié desc

    // Lignes du tableau
    var rows = shifts.length ? shifts.map(function (s) {
      var dur = s.shift_end ? Math.round((new Date(s.shift_end) - new Date(s.shift_start)) / 60000) + ' min' : '—';
      return '<tr>' +
        '<td>' + formatDate(s.shift_start) + '</td><td>' + formatTime(s.shift_start) + '</td>' +
        '<td>' + (s.shift_end ? formatDate(s.shift_end) : '<span class="active">EN COURS</span>') + '</td>' +
        '<td>' + (s.shift_end ? formatTime(s.shift_end) : '—') + '</td>' +
        '<td>' + dur + '</td>' +
        '<td><span class="badge ' + (s.status === 'ACTIVE' ? 'badge-on' : 'badge-off') + '">' + s.status + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="6" class="empty-row">Aucun shift enregistré</td></tr>';

    content.innerHTML =
      '<div class="modal-header">' +
        '<div class="modal-title-block">' +
          '<h2>' + escHtml(driver.full_name) + '</h2>' +
          '<span class="modal-matricule">Matricule : ' + escHtml(driver.matricule || 'non renseigné') + '</span>' +
        '</div>' +
        '<div class="modal-header-actions">' +
          '<button class="primary" onclick="downloadDriverPDF()">📄 PDF</button>' +
          '<button class="btn-fiche" onclick="downloadDriverExcel()">📊 Excel</button>' +
          '<button class="btn-close" onclick="closeModal()">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-stats">' +
        _stat(escHtml(driver.phone || '—'), 'Téléphone', '') +
        _stat(escHtml(driver.medical_expiration), expired ? '⚠️ Expiré' : '✅ Valide', expired ? 'stat-danger' : 'stat-ok') +
        _stat(activeShift ? 'ON SHIFT' : 'OFF SHIFT', 'Statut', activeShift ? 'stat-on' : '') +
        _stat(shifts.length, 'Total shifts', '') +
        _stat((totalMin / 60).toFixed(1) + 'h', 'Heures totales', '') +
        _stat((avgMin / 60).toFixed(2) + 'h', 'Moy/shift', '') +
        _stat(maxMs > 0 ? formatDuration(maxMs) : '—', 'Plus long', '') +
        _stat(lastShift ? formatDate(lastShift.shift_end) : '—', 'Dernier shift', '') +
      '</div>' +
      '<div class="modal-shifts-section">' +
        '<h3>Historique des shifts</h3>' +
        '<div class="modal-table-wrap">' +
          '<table>' +
            '<thead><tr><th>Date deb.</th><th>Heure deb.</th><th>Date fin</th><th>Heure fin</th><th>Durée</th><th>Statut</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  });
}

function _stat(val, lbl, cls) {
  return '<div class="stat-card ' + cls + '"><span class="stat-val">' + val + '</span><span class="stat-lbl">' + lbl + '</span></div>';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// =====================
// PDF — FICHE CHAUFFEUR
// =====================
function downloadDriverPDF() {
  var driver = modalDriver; var shifts = modalShifts;
  if (!driver) return;

  var jsPDF  = window.jspdf.jsPDF;
  var doc    = new jsPDF();
  var endedS = shifts.filter(function (s) { return s.shift_end; });
  var totalH = (endedS.reduce(function (a, s) {
    return a + (new Date(s.shift_end) - new Date(s.shift_start)) / 3600000;
  }, 0)).toFixed(1);

  doc.setFillColor(8,16,40); doc.rect(0,0,210,38,'F');
  doc.setTextColor(236,169,0); doc.setFontSize(20);
  doc.text('FICHE CHAUFFEUR', 105, 18, { align: 'center' });
  doc.setTextColor(255,255,255); doc.setFontSize(13);
  doc.text(driver.full_name, 105, 30, { align: 'center' });

  doc.setTextColor(0,0,0);
  doc.autoTable({
    startY: 45,
    body: [
      ['Nom complet',         driver.full_name],
      ['Téléphone',           driver.phone || '—'],
      ['Matricule',           driver.matricule || '—'],
      ['Expiration médicale', driver.medical_expiration],
      ['Enregistré le',       formatDate(driver.created_at)],
      ['Total shifts',        shifts.length],
      ['Heures travaillées',  totalH + 'h']
    ],
    theme: 'plain',
    columnStyles: { 0: { fontStyle:'bold', cellWidth:55 }, 1: { cellWidth:100 } },
    styles: { fontSize:10, cellPadding:3 }
  });

  var y = doc.lastAutoTable.finalY + 8;
  doc.setFillColor(236,169,0); doc.rect(14,y,182,12,'F');
  doc.setTextColor(8,16,40); doc.setFontSize(9);
  doc.text('Rapport généré le ' + new Date().toLocaleString('fr-FR'), 19, y+8);

  var rows = shifts.map(function (s) {
    var dur = s.shift_end ? Math.round((new Date(s.shift_end)-new Date(s.shift_start))/60000)+' min' : '—';
    return [formatDate(s.shift_start), formatTime(s.shift_start),
            s.shift_end ? formatDate(s.shift_end) : 'EN COURS',
            s.shift_end ? formatTime(s.shift_end) : '—', dur, s.status];
  });
  doc.autoTable({
    startY: y + 18,
    head: [['Date deb.','Heure deb.','Date fin','Heure fin','Durée','Statut']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor:[236,169,0], textColor:[8,16,40], fontStyle:'bold' },
    styles: { fontSize:8, cellPadding:2 }
  });

  doc.save('fiche_' + driver.full_name.replace(/\s+/g,'_') + '_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('PDF téléchargé ✓', 'success');
}

// =====================
// EXCEL — FICHE CHAUFFEUR
// =====================
function downloadDriverExcel() {
  var driver = modalDriver; var shifts = modalShifts;
  if (!driver) return;

  var wb   = XLSX.utils.book_new();
  var endedS = shifts.filter(function (s) { return s.shift_end; });
  var totalH = (endedS.reduce(function (a,s) {
    return a + (new Date(s.shift_end)-new Date(s.shift_start))/3600000;
  }, 0)).toFixed(1);

  var ws1 = XLSX.utils.json_to_sheet([
    { Champ:'Nom complet',        Valeur: driver.full_name },
    { Champ:'Téléphone',          Valeur: driver.phone || '' },
    { Champ:'Matricule',          Valeur: driver.matricule || '' },
    { Champ:'Expiration médicale',Valeur: driver.medical_expiration },
    { Champ:'Enregistré le',      Valeur: formatDate(driver.created_at) },
    { Champ:'Total shifts',       Valeur: shifts.length },
    { Champ:'Heures travaillées', Valeur: totalH + 'h' }
  ]);
  ws1['!cols'] = [{wch:26},{wch:32}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Informations');

  var rows = shifts.length ? shifts.map(function (s) {
    return {
      'Date début':  formatDate(s.shift_start),
      'Heure début': formatTime(s.shift_start),
      'Date fin':    s.shift_end ? formatDate(s.shift_end) : 'EN COURS',
      'Heure fin':   s.shift_end ? formatTime(s.shift_end) : '',
      'Durée (min)': s.shift_end ? Math.round((new Date(s.shift_end)-new Date(s.shift_start))/60000) : '',
      'Statut':      s.status
    };
  }) : [{ Info:'Aucun shift enregistré' }];

  var ws2 = XLSX.utils.json_to_sheet(rows);
  ws2['!cols'] = [{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Shifts');

  XLSX.writeFile(wb, 'fiche_' + driver.full_name.replace(/\s+/g,'_') + '.xlsx');
  showToast('Excel téléchargé ✓', 'success');
}

// =====================
// LOAD SHIFTS — paginé + date/heure séparées
// =====================
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
          var start = shift.shift_start ? new Date(shift.shift_start) : null;
          var end   = shift.shift_end   ? new Date(shift.shift_end)   : null;
          var dur   = (start && end) ? formatDuration(end - start) : '—';

          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td><strong>' + escHtml(shift.drivers ? shift.drivers.full_name : '—') + '</strong></td>' +
            '<td>' + (start ? formatDate(start) : '—') + '</td>' +
            '<td>' + (start ? formatTime(start) : '—') + '</td>' +
            '<td>' + (end ? formatDate(end) : '<span class="active">EN COURS</span>') + '</td>' +
            '<td>' + (end ? formatTime(end) : '—') + '</td>' +
            '<td>' + dur + '</td>' +
            '<td><span class="badge ' + (shift.status === 'ACTIVE' ? 'badge-on' : 'badge-off') + '">' + shift.status + '</span></td>';
          tbody.appendChild(tr);
        });
      }
      renderPagination('shiftsPagination', page, count, loadShifts);
    });
}

// =====================
// EXPORT PDF — SHIFTS
// =====================
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

    var jsPDF = window.jspdf.jsPDF;
    var doc   = new jsPDF({ orientation: 'landscape' });

    doc.setFillColor(8,16,40); doc.rect(0,0,297,28,'F');
    doc.setTextColor(236,169,0); doc.setFontSize(18);
    doc.text('RAPPORT DES SHIFTS', 148, 17, { align: 'center' });

    doc.setTextColor(8,16,40); doc.setFontSize(9);
    doc.text('Généré le ' + new Date().toLocaleString('fr-FR'), 14, 38);
    if (startDate || endDate)
      doc.text('Période : ' + (startDate||'début') + ' → ' + (endDate||"aujourd'hui"), 14, 44);

    var rows = (r.data||[]).map(function (s) {
      var start = s.shift_start ? new Date(s.shift_start) : null;
      var end   = s.shift_end   ? new Date(s.shift_end)   : null;
      var dur   = (start && end) ? Math.round((end-start)/60000) + ' min' : '—';
      return [
        s.drivers ? s.drivers.full_name : '—',
        s.drivers ? (s.drivers.phone||'') : '',
        s.drivers ? (s.drivers.matricule||'') : '',
        start ? formatDate(start) : '—',
        start ? formatTime(start) : '—',
        end   ? formatDate(end)   : 'EN COURS',
        end   ? formatTime(end)   : '—',
        dur, s.status
      ];
    });

    doc.autoTable({
      startY: 50,
      head: [['Chauffeur','Téléphone','Matricule','Date deb.','Heure deb.','Date fin','Heure fin','Durée','Statut']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor:[236,169,0], textColor:[8,16,40], fontStyle:'bold' },
      styles: { fontSize:8, cellPadding:2 }
    });

    doc.save('shifts_' + new Date().toISOString().slice(0,10) + '.pdf');
    showToast('PDF exporté ✓', 'success');
  });
}

// =====================
// EXPORT CSV — SHIFTS (bien formaté)
// =====================
function exportShiftsCSV() {
  var startDate = document.getElementById('startDate').value;
  var endDate   = document.getElementById('endDate').value;

  var q = client.from('shifts')
    .select('*, drivers(full_name, phone, matricule)')
    .order('shift_start', { ascending: false });
  if (startDate) q = q.gte('shift_start', startDate);
  if (endDate)   q = q.lte('shift_start', endDate + 'T23:59:59');

  q.then(function (r) {
    if (r.error) { showToast(r.error.message, 'error'); return; }

    var BOM  = '\uFEFF'; // UTF-8 BOM pour Excel FR
    var SEP  = ';';      // séparateur FR
    var rows = [
      ['Chauffeur','Téléphone','Matricule','Date début','Heure début','Date fin','Heure fin','Durée (min)','Statut']
    ];

    (r.data||[]).forEach(function (s) {
      var start = s.shift_start ? new Date(s.shift_start) : null;
      var end   = s.shift_end   ? new Date(s.shift_end)   : null;
      var dur   = (start && end) ? Math.round((end-start)/60000) : '';
      rows.push([
        s.drivers ? s.drivers.full_name : '',
        s.drivers ? (s.drivers.phone    || '') : '',
        s.drivers ? (s.drivers.matricule|| '') : '',
        start ? formatDate(start)   : '',
        start ? formatTime(start)   : '',
        end   ? formatDate(end)     : 'EN COURS',
        end   ? formatTime(end)     : '',
        dur,
        s.status
      ]);
    });

    var csv  = BOM + rows.map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? '' : c);
        // Échapper les guillemets, encadrer si virgule/point-virgule
        if (s.includes(SEP) || s.includes('"') || s.includes('\n')) {
          s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(SEP);
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'shifts_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exporté ✓', 'success');
  });
}
