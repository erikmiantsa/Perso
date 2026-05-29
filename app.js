const SUPABASE_URL = 'https://gtznlfzjcqbbrtzftmyp.supabase.co'
const SUPABASE_KEY = 'sb_publishable_FGc8tmPt5hdTALGqgTo0mw_F_rVPzv1'

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

loadDrivers()
loadShifts()

// =====================
// TOAST
// =====================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast')

    toast.className = `toast show ${type}`
    toast.innerText = message

    setTimeout(() => {
        toast.className = 'toast'
    }, 2500)
}

// =====================
// ADD DRIVER
// =====================
async function addDriver() {

    const full_name = document.getElementById('name').value
    const phone = document.getElementById('phone').value
    const vehicle = document.getElementById('vehicle').value
    const medical_expiration = document.getElementById('medical').value

    if (!full_name || !medical_expiration) {
        showToast('Please fill required fields', 'error')
        return
    }

    const { error } = await client
        .from('drivers')
        .insert([{ full_name, phone, vehicle, medical_expiration }])

    if (error) {
        showToast(error.message, 'error')
        return
    }

    showToast('Driver added successfully', 'success')
    clearForm()
    loadDrivers()
}

function clearForm() {
    document.getElementById('name').value = ''
    document.getElementById('phone').value = ''
    document.getElementById('vehicle').value = ''
    document.getElementById('medical').value = ''
}

// =====================
// LOAD DRIVERS
// =====================
async function loadDrivers() {

    const { data, error } = await client
        .from('drivers')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        console.log(error)
        return
    }

    const table = document.getElementById('driverTable')
    table.innerHTML = ''

    for (const driver of data) {

        const activeShift = await getActiveShift(driver.id)

        const today = new Date()
        const medicalDate = new Date(driver.medical_expiration)

        const expired = medicalDate < today

        const canStart = !activeShift && !expired
        const canEnd = !!activeShift

        // SAFE BUTTONS (NO DISAPPEARING ISSUE)
        let startBtn = `
            <button onclick="startShift('${driver.id}', '${driver.medical_expiration}')">
                Start Shift
            </button>
        `

        let endBtn = `
            <button onclick="endShift('${driver.id}')">
                End Shift
            </button>
        `

        if (!canStart) {
            startBtn = `<button disabled>Start Shift</button>`
        }

        if (!canEnd) {
            endBtn = `<button disabled>End Shift</button>`
        }

        const tr = document.createElement('tr')

        tr.innerHTML = `
            <td>${driver.full_name}</td>
            <td>${driver.phone || ''}</td>
            <td>${driver.vehicle || ''}</td>
            <td class="${expired ? 'expired' : ''}">
                ${driver.medical_expiration}
            </td>
            <td class="${activeShift ? 'active' : ''}">
                ${activeShift ? 'ON SHIFT' : 'OFF SHIFT'}
            </td>
            <td>
                ${startBtn}
                ${endBtn}
                <button onclick="updateMedical('${driver.id}')">
                    Update Medical
                </button>
            </td>
        `

        table.appendChild(tr)
    }
}

// =====================
// SHIFT LOGIC
// =====================
async function getActiveShift(driverId) {

    const { data } = await client
        .from('shifts')
        .select('*')
        .eq('driver_id', driverId)
        .is('shift_end', null)
        .maybeSingle()

    return data
}

async function startShift(driverId, medicalExpiration) {

    const today = new Date()
    const medicalDate = new Date(medicalExpiration)

    if (medicalDate < today) {
        showToast('Medical certificate expired', 'error')
        return
    }

    const activeShift = await getActiveShift(driverId)

    if (activeShift) {
        showToast('Driver already on shift', 'error')
        return
    }

    const { error } = await client
        .from('shifts')
        .insert([{
            driver_id: driverId,
            shift_start: new Date().toISOString(),
            status: 'ACTIVE'
        }])

    if (error) {
        showToast(error.message, 'error')
        return
    }

    showToast('Shift started successfully', 'success')
    loadDrivers()
}

async function endShift(driverId) {

    const activeShift = await getActiveShift(driverId)

    if (!activeShift) {
        showToast('No active shift found', 'error')
        return
    }

    const { error } = await client
        .from('shifts')
        .update({
            shift_end: new Date().toISOString(),
            status: 'ENDED'
        })
        .eq('id', activeShift.id)

    if (error) {
        showToast(error.message, 'error')
        return
    }

    showToast('Shift ended successfully', 'success')
    loadDrivers()
}

// =====================
// MEDICAL
// =====================
async function updateMedical(driverId) {

    const newDate = prompt('Enter new medical expiration date (YYYY-MM-DD)')
    if (!newDate) return

    const { error } = await client
        .from('drivers')
        .update({ medical_expiration: newDate })
        .eq('id', driverId)

    if (error) {
        showToast(error.message, 'error')
        return
    }

    showToast('Medical updated', 'success')
    loadDrivers()
}

// =====================
// SHIFT HISTORY
// =====================
async function loadShifts() {

    const { data, error } = await client
        .from('shifts')
        .select(`
            *,
            drivers(full_name)
        `)
        .order('created_at', { ascending: false })

    if (error) return console.log(error)

    const table = document.getElementById('shiftTable')
    table.innerHTML = ''

    data.forEach(shift => {

        const tr = document.createElement('tr')

        tr.innerHTML = `
            <td>${shift.drivers?.full_name || ''}</td>
            <td>${new Date(shift.shift_start).toLocaleString()}</td>
            <td>${shift.shift_end ? new Date(shift.shift_end).toLocaleString() : 'ONGOING'}</td>
            <td>${shift.status}</td>
        `

        table.appendChild(tr)
    })
}

// =====================
// CSV EXPORT
// =====================
window.exportCSV = async function () {

    const startDate = document.getElementById('startDate').value
    const endDate = document.getElementById('endDate').value

    let query = client
        .from('shifts')
        .select(`*, drivers(full_name)`)
        .order('shift_start', { ascending: false })

    if (startDate) query = query.gte('shift_start', startDate)
    if (endDate) query = query.lte('shift_start', endDate + 'T23:59:59')

    const { data, error } = await query

    if (error) {
        showToast(error.message, 'error')
        return
    }

    const rows = [
        ['Driver', 'Start', 'End', 'Status']
    ]

    data.forEach(s => {
        rows.push([
            s.drivers?.full_name || '',
            s.shift_start,
            s.shift_end || 'ONGOING',
            s.status
        ])
    })

    const csv = rows.map(r => r.join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `shifts_${Date.now()}.csv`
    a.click()

    URL.revokeObjectURL(url)

    showToast('CSV exported successfully', 'success')
}