// script.js
// Full working workout logic for mobile-first UI
// Updated: Single-canvas chart system (fixes layout offset bug)

'use strict';

const STORAGE_SETTINGS_KEY = 'wt_settings_v1';
const STORAGE_WORKOUTS_KEY = 'wt_workouts_v1';

let settings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY)) || { defaultUnit: 'kg', appearance: 'light' };
let workouts = JSON.parse(localStorage.getItem(STORAGE_WORKOUTS_KEY)) || [];
let editIndex = null;

// Chart.js single canvas
let progressChart = null;

// Runtime timers/state
let workoutStarted = false;
let workoutSeconds = 0;
let workoutTimer = null;
let activeRowIndex = null;
let rowTimers = [];

// Utility --------------------------------------------------------------
function persistSettings() {
	localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
}

function persistWorkouts() {
	localStorage.setItem(STORAGE_WORKOUTS_KEY, JSON.stringify(workouts));
}

function formatTime(secs) {
	const s = Math.max(0, parseInt(secs) || 0);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
	const ss = (s % 60).toString().padStart(2, '0');
	return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}

function escapeHtml(str) {
	if (str == null) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function applyAppearance() {
	document.body.classList.toggle('dark', settings.appearance === 'dark');
}

// Row helpers ---------------------------------------------------------
function createDoneButtonForRow(row) {
	let doneCell = row.querySelector('.done-col-cell');
	if (!doneCell) {
		doneCell = document.createElement('td');
		doneCell.className = 'done-col-cell';
		row.insertBefore(doneCell, row.firstChild);
	}
	doneCell.innerHTML = '';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'row-done-btn';
	btn.textContent = '✓';
	btn.title = 'Mark done';
	btn.style.display = workoutStarted ? 'inline-block' : 'none';
	btn.addEventListener('click', () => completeRow(row));
	doneCell.appendChild(btn);
	return btn;
}

function addRowListeners(row) {
	const slider = row.querySelector('.difficulty-slider');
	const sliderValue = row.querySelector('.difficulty-value');
	if (slider && sliderValue) {
		slider.addEventListener('input', () => {
			sliderValue.textContent = slider.value;
		});
	}

	const dropsetCb = row.querySelector('.dropset-checkbox');
	if (dropsetCb) dropsetCb.addEventListener('change', (e) => toggleDropSet(e.target));

	const repsInput = row.querySelector('.reps-cell input[type="number"]');
	if (repsInput) repsInput.addEventListener('input', () => updateDropSetInputs(repsInput));
}

// Add exercise / break ------------------------------------------------
function addExercise(ex = {}) {
	const table = document.getElementById('workoutTable');
	const row = table.insertRow(-1);
	row.className = 'exercise-row';

	let rowHtml = '';
	if (workoutStarted) rowHtml += '<td class="done-col-cell"></td>';
	rowHtml += `
		<td class="exercise-cell"><input type="text" placeholder="Exercise" value="${escapeHtml(ex.name || '')}"></td>
		<td class="reps-cell"><input type="number" min="1" value="${ex.reps ?? 10}"></td>
		<td class="weight-cell">
			<div class="weight-line">
				<input type="number" min="0" class="single-weight" value="${ex.dropset ? '' : (Array.isArray(ex.weights) ? (ex.weights[0] ?? 0) : (ex.weight ?? 0))}">
				<select class="unit-select">
					<option value="kg"${((ex.unit || settings.defaultUnit) === 'kg' ? ' selected' : '')}>kg</option>
					<option value="lbs"${((ex.unit || settings.defaultUnit) === 'lbs' ? ' selected' : '')}>lbs</option>
				</select>
				<label style="font-size:12px;"><input type="checkbox" class="dropset-checkbox"${(ex.dropset ? ' checked' : '')}> dropset</label>
			</div>
			<div class="dropset-inputs" style="display:${(ex.dropset ? '' : 'none')}"></div>
		</td>
		<td class="difficulty-cell">
			<input type="range" min="1" max="10" value="${ex.difficulty || 5}" class="difficulty-slider">
			<span class="difficulty-value">${ex.difficulty || 5}</span>
		</td>
		<td class="notes-cell"><input type="text" placeholder="Notes" value="${escapeHtml(ex.notes || '')}"></td>
		<td class="remove-col"></td>`;
	row.innerHTML = rowHtml;

	const removeBtn = document.createElement('button');
	removeBtn.type = 'button';
	removeBtn.className = 'row-remove-btn';
	removeBtn.textContent = 'X';
	removeBtn.title = 'Remove row';
	removeBtn.addEventListener('click', () => row.remove());
	row.querySelector('.remove-col').appendChild(removeBtn);

	if (workoutStarted) createDoneButtonForRow(row);
	addRowListeners(row);

	if (ex.dropset && Array.isArray(ex.weights) && ex.weights.length) {
		const cb = row.querySelector('.dropset-checkbox');
		if (cb) toggleDropSet(cb, ex.weights);
	}
}

function addBreak(br = {}) {
	const table = document.getElementById('workoutTable');
	const row = table.insertRow(-1);
	row.className = 'break-row';
	const duration = br.duration || 60;
	let rowHtml = '';
	if (workoutStarted) rowHtml += '<td class="done-col-cell"></td>';
	const colspan = workoutStarted ? 7 : 7;
	rowHtml += `<td class="break-cell" colspan="${colspan}" style="text-align:center;">
		Break: <input type="number" min="1" value="${duration}"> sec
	</td>`;
	row.innerHTML = rowHtml;

	const remBtn = document.createElement('button');
	remBtn.type = 'button';
	remBtn.className = 'row-remove-btn';
	remBtn.textContent = 'X';
	remBtn.title = 'Remove break';
	remBtn.style.marginLeft = '8px';
	remBtn.addEventListener('click', () => row.remove());
	row.querySelector('.break-cell').appendChild(remBtn);
	row.dataset.plannedDuration = duration;

	if (workoutStarted) createDoneButtonForRow(row);
}

// Dropset helpers -----------------------------------------------------
function toggleDropSet(checkbox, restoreValues = []) {
	const row = checkbox.closest('tr');
	if (!row) return;
	const dropsetContainer = row.querySelector('.dropset-inputs');
	const singleWeight = row.querySelector('.single-weight');
	const repsInput = row.querySelector('.reps-cell input[type="number"]');
	if (dropsetContainer) dropsetContainer.innerHTML = '';

	if (checkbox.checked) {
		if (dropsetContainer) dropsetContainer.style.display = '';
		if (singleWeight) singleWeight.style.display = 'none';
		const count = Math.max(1, parseInt(repsInput?.value) || 1);
		for (let i = 0; i < count; i++) {
			const w = document.createElement('input');
			w.type = 'number';
			w.min = '0';
			w.value = (restoreValues[i] != null) ? restoreValues[i] : (i === 0 && singleWeight && singleWeight.value ? singleWeight.value : 0);
			dropsetContainer.appendChild(w);
		}
	} else {
		if (dropsetContainer) dropsetContainer.style.display = 'none';
		if (dropsetContainer) dropsetContainer.innerHTML = '';
		if (singleWeight) singleWeight.style.display = '';
		if (restoreValues.length && singleWeight) singleWeight.value = restoreValues[0];
	}
}

function updateDropSetInputs(repsInput) {
	const row = repsInput.closest('tr');
	if (!row) return;
	const dropsetCb = row.querySelector('.dropset-checkbox');
	if (!dropsetCb || !dropsetCb.checked) return;
	const container = row.querySelector('.dropset-inputs');
	const current = Array.from(container.querySelectorAll('input'));
	const newCount = Math.max(1, parseInt(repsInput.value) || 1);
	if (current.length < newCount) {
		const lastVal = current.length ? current[current.length - 1].value : 0;
		for (let i = current.length; i < newCount; i++) {
			const w = document.createElement('input');
			w.type = 'number';
			w.min = '0';
			w.value = lastVal || 0;
			container.appendChild(w);
		}
	} else if (current.length > newCount) {
		for (let i = current.length - 1; i >= newCount; i--) container.removeChild(current[i]);
	}
}

// Row stopwatch / timers ---------------------------------------------
function ensureTimeDisplayOnRow(row) {
	if (!row.querySelector('.time-display')) {
		const td = document.createElement('td');
		td.style.display = 'none';
		td.className = 'time-cell';
		const existing = row.dataset._time || 0;
		td.innerHTML = `<span class="time-display" data-seconds="${existing}">${formatTime(existing)}</span>`;
		row.appendChild(td);
	}
}

function startRowTimer(index) {
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	if (index < 0 || index >= rows.length) return;
	if (activeRowIndex !== null && activeRowIndex !== index) stopRowTimer(activeRowIndex);

	const row = rows[index];
	ensureTimeDisplayOnRow(row);
	const display = row.querySelector('.time-display');
	if (!display) return;

	let elapsed = parseInt(display.dataset.seconds || '0') || 0;
	if (rowTimers[index]) clearInterval(rowTimers[index]);
	rowTimers[index] = setInterval(() => {
		elapsed++;
		display.dataset.seconds = elapsed;
		display.textContent = formatTime(elapsed);
	}, 1000);
	activeRowIndex = index;
}

function stopRowTimer(index) {
	if (rowTimers[index]) {
		clearInterval(rowTimers[index]);
		rowTimers[index] = null;
	}
	if (activeRowIndex === index) activeRowIndex = null;
}

function computeTotalFromRows() {
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	return rows.reduce((sum, r) => sum + (parseInt(r.querySelector('.time-display')?.dataset.seconds || '0') || 0), 0);
}

// Global workout timer ------------------------------------------------
function startWorkoutTimer() {
	const display = document.getElementById('workoutTotalTimer');
	workoutSeconds = 0;
	if (workoutTimer) clearInterval(workoutTimer);
	workoutTimer = setInterval(() => {
		workoutSeconds++;
		display.textContent = 'Total Time: ' + formatTime(workoutSeconds);
	}, 1000);
}

function stopWorkoutTimer() {
	if (workoutTimer) {
		clearInterval(workoutTimer);
		workoutTimer = null;
	}
}

// Break countdown behavior -------------------------------------------
function startBreakCountdown(breakRow) {
	const cell = breakRow.querySelector('.break-cell');
	if (!cell) return;
	let planned = parseInt(breakRow.dataset.plannedDuration || 0) || 0;
	if (!planned) planned = 60;
	breakRow.dataset.plannedDuration = planned;

	if (breakRow._countdown) {
		return;
	}

	ensureTimeDisplayOnRow(breakRow);

	if (breakRow._timeLeft == null) {
		breakRow._timeLeft = planned;
	}

	cell.innerHTML = '';
	const display = document.createElement('span');
	display.className = 'break-countdown';
	cell.appendChild(display);

	const btnAdd = document.createElement('button'); btnAdd.type = 'button'; btnAdd.className = 'small'; btnAdd.textContent = '+10s';
	const btnSub = document.createElement('button'); btnSub.type = 'button'; btnSub.className = 'small'; btnSub.textContent = '-10s';
	const btnReset = document.createElement('button'); btnReset.type = 'button'; btnReset.className = 'small'; btnReset.textContent = 'Reset';
	const btnSkip = document.createElement('button'); btnSkip.type = 'button'; btnSkip.className = 'small'; btnSkip.textContent = 'Skip';

	[btnAdd, btnSub, btnReset, btnSkip].forEach(b => {
		b.style.padding = '6px 8px';
		b.style.marginLeft = '6px';
	});

	cell.appendChild(btnAdd);
	cell.appendChild(btnSub);
	cell.appendChild(btnReset);
	cell.appendChild(btnSkip);

	function updateDisplay() {
		const left = breakRow._timeLeft;
		if (left <= 0) {
			display.textContent = 'Break complete!';
			breakRow.classList.remove('break-warning');
			breakRow.classList.add('break-done');
			if (breakRow._countdown) {
				clearInterval(breakRow._countdown);
				breakRow._countdown = null;
			}
			const timeDisplay = breakRow.querySelector('.time-display');
			if (timeDisplay) {
				timeDisplay.dataset.seconds = (parseInt(timeDisplay.dataset.seconds || 0) || 0) + parseInt(breakRow.dataset.plannedDuration || 0);
			}
			const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
			const idx = rows.indexOf(breakRow);
			stopRowTimer(idx);
			if (idx + 1 < rows.length) {
				startRowTimer(idx + 1);
				const next = rows[idx + 1];
				if (next.classList.contains('break-row')) {
					startBreakCountdown(next);
				}
			}
		} else {
			display.textContent = 'Break: ' + left + 's';
			if (left <= 10) {
				breakRow.classList.add('break-warning');
			} else {
				breakRow.classList.remove('break-warning');
			}
		}
	}

	function restartCountdown() {
		if (breakRow._timeLeft > 0 && !breakRow._countdown) {
			breakRow._countdown = setInterval(() => {
				breakRow._timeLeft--;
				updateDisplay();
			}, 1000);
		}
	}

	btnAdd.addEventListener('click', () => {
		breakRow._timeLeft += 10;
		updateDisplay();
		restartCountdown();
	});
	btnSub.addEventListener('click', () => {
		breakRow._timeLeft = Math.max(0, breakRow._timeLeft - 10);
		updateDisplay();
		restartCountdown();
	});
	btnReset.addEventListener('click', () => {
		breakRow._timeLeft = parseInt(breakRow.dataset.plannedDuration || 0) || 0;
		updateDisplay();
		restartCountdown();
	});
	btnSkip.addEventListener('click', () => {
		breakRow._timeLeft = 0;
		updateDisplay();
	});

	updateDisplay();
	restartCountdown();
}

// Completing a row ----------------------------------------------------
function completeRow(row) {
	const table = document.getElementById('workoutTable');
	const rows = Array.from(table.rows).slice(1);
	const idx = rows.indexOf(row);
	if (idx < 0) return;

	if (row.classList.contains('break-row')) {
		if (row._countdown) {
			clearInterval(row._countdown);
			row._countdown = null;
		}
		row.classList.remove('break-warning');
		row.classList.add('break-done');
	} else {
		row.classList.add('exercise-done');
	}

	stopRowTimer(idx);

	if (idx + 1 < rows.length) {
		const next = rows[idx + 1];
		startRowTimer(idx + 1);
		if (next.classList.contains('break-row')) {
			const inp = next.querySelector('.break-cell input[type="number"]');
			if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0) || 0;
			next._timeLeft = parseInt(next.dataset.plannedDuration || 0) || 0;
			startBreakCountdown(next);
		}
	} else {
		endWorkout();
		const btn = document.getElementById('startWorkoutBtn');
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
	}
}

// Start / End workout -------------------------------------------------
function startWorkout() {
	const btn = document.getElementById('startWorkoutBtn');
	const table = document.getElementById('workoutTable');
	const rows = Array.from(table.rows).slice(1);

	if (btn.dataset.active === 'true') {
		endWorkout();
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
		const header = document.querySelector('#headerRow .done-col');
		if (header) header.remove();
		const table2 = document.getElementById('workoutTable');
		Array.from(table2.rows).forEach(row => {
			const doneCell = row.querySelector('.done-col-cell');
			if (doneCell) doneCell.remove();
		});
		return;
	}

	if (!rows.length) {
		alert('Add at least one exercise first.');
		return;
	}

	document.body.classList.add('show-workout');
	const header = document.querySelector('#headerRow');
	if (header && !header.querySelector('.done-col')) {
		const th = document.createElement('th');
		th.className = 'done-col';
		th.textContent = '✓';
		header.insertBefore(th, header.firstChild);
	}

	rows.forEach(r => {
		if (!r.querySelector('.done-col-cell')) {
			const td = document.createElement('td');
			td.className = 'done-col-cell';
			r.insertBefore(td, r.firstChild);
		}
		const doneBtn = createDoneButtonForRow(r);
		doneBtn.style.display = 'inline-block';
		if (r.classList.contains('break-row')) {
			const inp = r.querySelector('.break-cell input[type="number"]');
			if (inp) r.dataset.plannedDuration = parseInt(inp.value || 0) || 0;
			r._timeLeft = parseInt(r.dataset.plannedDuration || 0) || 0;
		}
		ensureTimeDisplayOnRow(r);
	});

	btn.textContent = 'End';
	btn.dataset.active = 'true';
	btn.classList.add('end');
	document.getElementById('workoutTotalTimer').style.display = 'block';
	document.getElementById('workoutTotalTimer').textContent = 'Total Time: 00:00';
	workoutStarted = true;

	startRowTimer(0);
	const first = rows[0];
	if (first && first.classList.contains('break-row')) {
		first.dataset.plannedDuration = parseInt(first.dataset.plannedDuration || 0) || 0;
		first._timeLeft = parseInt(first.dataset.plannedDuration || 0) || 0;
		startBreakCountdown(first);
	}

	startWorkoutTimer();
}

function endWorkout() {
	rowTimers.forEach((id, i) => { if (id) clearInterval(id); rowTimers[i] = null; });
	activeRowIndex = null;
	stopWorkoutTimer();
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	rows.forEach(r => {
		if (r._countdown) { clearInterval(r._countdown); r._countdown = null; }
		r.classList.remove('break-warning');
	});
	workoutStarted = false;
	rows.forEach(r => {
		const doneBtn = r.querySelector('.done-col-cell button');
		if (doneBtn) doneBtn.style.display = 'none';
	});
}

// Save / Edit / Delete / Cancel ---------------------------------------
function saveWorkout() {
	endWorkout();

	const table = document.getElementById('workoutTable');
	const rows = Array.from(table.rows).slice(1);
	if (!rows.length) { alert('Add at least one exercise!'); return; }

	const exercises = rows.map(r => {
		const td = r.querySelector('.time-display');
		const secs = parseInt(td?.dataset.seconds || 0) || 0;

		if (r.classList.contains('break-row')) {
			const planned = parseInt(r.dataset.plannedDuration || 0) || (parseInt(r.querySelector('.break-cell input')?.value || 0) || 0);
			return { type: 'break', duration: planned, time: secs };
		} else {
			const name = r.querySelector('.exercise-cell input')?.value || '';
			const reps = parseInt(r.querySelector('.reps-cell input')?.value || 0) || 0;
			let weights = [];
			if (r.querySelector('.dropset-checkbox')?.checked) {
				weights = Array.from(r.querySelectorAll('.dropset-inputs input')).map(i => i.value || 0);
			} else {
				weights = [r.querySelector('.single-weight')?.value || 0];
			}
			const unit = r.querySelector('.unit-select')?.value || settings.defaultUnit;
			const difficulty = parseInt(r.querySelector('.difficulty-slider')?.value || 0) || 0;
			const notes = r.querySelector('.notes-cell input')?.value || '';
			return {
				type: 'exercise',
				name,
				reps,
				weights,
				unit,
				dropset: !!r.querySelector('.dropset-checkbox')?.checked,
				difficulty,
				notes,
				time: secs
			};
		}
	});

	let totalTime = 0;
	if (workoutSeconds && workoutStarted) {
		totalTime = workoutSeconds;
	} else {
		totalTime = exercises.reduce((s, ex) => s + (parseInt(ex.time) || 0), 0);
	}

	if (editIndex != null) {
		workouts[editIndex].exercises = exercises;
		workouts[editIndex].date = new Date().toLocaleString();
		workouts[editIndex].totalTime = totalTime;
		editIndex = null;
		document.getElementById('cancelEditBtn').style.display = 'none';
	} else {
		workouts.push({ date: new Date().toLocaleString(), exercises, totalTime });
	}

	persistWorkouts();
	renderHistory();
	updateExerciseSelector();
	renderProgress();

	const headerHtml = document.getElementById('workoutTable').rows[0].outerHTML;
	document.getElementById('workoutTable').innerHTML = headerHtml;

	workoutSeconds = 0;
	workoutStarted = false;
	document.getElementById('workoutTotalTimer').style.display = 'none';
	document.body.classList.remove('show-workout');

	const btn = document.getElementById('startWorkoutBtn');
	btn.textContent = 'Start';
	btn.dataset.active = 'false';
	btn.classList.remove('end');
}

function editWorkout(index) {
	const table = document.getElementById('workoutTable');
	table.innerHTML = table.rows[0].outerHTML;
	const w = workouts[index];
	(w.exercises || []).forEach(ex => {
		if (ex.type === 'break') addBreak(ex);
		else addExercise(ex);
	});
	editIndex = index;
	document.getElementById('cancelEditBtn').style.display = 'inline-block';
	document.getElementById('workoutTotalTimer').style.display = 'block';
	document.getElementById('workoutTotalTimer').textContent = 'Total Time: ' + formatTime(w.totalTime || 0);

	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	rows.forEach((r, i) => {
		const original = (w.exercises || [])[i];
		if (!original) return;
		ensureTimeDisplayOnRow(r);
		const td = r.querySelector('.time-display');
		if (td) td.dataset.seconds = original.time || 0;
		if (r.classList.contains('break-row')) {
			r.dataset.plannedDuration = original.duration || 0;
			r._timeLeft = original.duration || 0;
		}
	});
}

function deleteWorkout(index) {
	if (!confirm('Are you sure you want to delete this workout?')) return;
	workouts.splice(index, 1);
	persistWorkouts();
	renderHistory();
	updateExerciseSelector();
	renderProgress();
}

function cancelEdit() {
	editIndex = null;
	document.getElementById('cancelEditBtn').style.display = 'none';
	document.getElementById('workoutTable').innerHTML = document.getElementById('workoutTable').rows[0].outerHTML;
	document.getElementById('workoutTotalTimer').style.display = 'none';
	workoutStarted = false;
	workoutSeconds = 0;
}

// History & Progress --------------------------------------------------
function renderHistory() {
	const historyDiv = document.getElementById('history');
	historyDiv.innerHTML = '';

	workouts.slice().reverse().forEach((workout, i) => {
		const actualIndex = workouts.length - 1 - i;
		const div = document.createElement('div');
		div.className = 'history-entry';
		const strong = document.createElement('strong');
		strong.textContent = workout.date;
		const span = document.createElement('span');
		span.textContent = ' Total Time: ' + formatTime(workout.totalTime || 0);

		const editBtn = document.createElement('button');
		editBtn.className = 'edit-btn';
		editBtn.textContent = 'Edit';
		editBtn.addEventListener('click', () => editWorkout(actualIndex));

		const delBtn = document.createElement('button');
		delBtn.className = 'delete-btn';
		delBtn.textContent = 'Delete';
		delBtn.addEventListener('click', () => deleteWorkout(actualIndex));

		const table = document.createElement('table');
		table.className = 'history-table';
		const thead = document.createElement('tr');
		thead.innerHTML = '\
    <th>Time</th>\
    <th>Exercise</th>\
    <!-- <th>Sets x Reps</th> -->\
    <th>Reps</th>\
    <th>Weight</th>\
    <th>Difficulty</th>\
    <th>Notes</th>';
		table.appendChild(thead);

		(workout.exercises || []).forEach(ex => {
			const tr = document.createElement('tr');
			if (ex.type === 'break') {
				tr.innerHTML = '<td>' + formatTime(ex.time || 0) + '</td><td colspan="5" style="text-align:center; font-style:italic;">Break: ' + (ex.duration || 0) + ' sec</td>';
			} else {
				const repsDisplay = ex.reps || 0;
				const weightsDisplay = ex.dropset ? (Array.isArray(ex.weights) ? ex.weights.join(' → ') : ex.weights) : (Array.isArray(ex.weights) ? ex.weights[0] : ex.weights);
				const unit = ex.unit || settings.defaultUnit;
				const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
				tr.innerHTML = '<td>' + formatTime(ex.time || 0) + '</td>' +
					'<td>' + escapeHtml(ex.name || '') + '</td>' +
					'<td>' + escapeHtml(String(repsDisplay)) + '</td>' +
					'<td>' + escapeHtml(String(weightsDisplay || '0')) + ' ' + escapeHtml(unit) + (ex.dropset ? ' (dropset)' : '') + '</td>' +
					'<td>' + escapeHtml(String(difficultyDisplay)) + '/10</td>' +
					'<td>' + escapeHtml(ex.notes || '') + '</td>';
			}
			table.appendChild(tr);
		});

		const wrap = document.createElement('div');
		wrap.className = 'table-wrapper';
		wrap.appendChild(table);

		div.appendChild(strong);
		div.appendChild(span);
		div.appendChild(editBtn);
		div.appendChild(delBtn);
		div.appendChild(wrap);
		historyDiv.appendChild(div);
	});
}

function updateExerciseSelector() {
	const select = document.getElementById('exerciseSelect');
	if (!select) return;
	const names = new Set();
	workouts.forEach(w => {
		(w.exercises || []).forEach(ex => {
			if (ex.type === 'exercise' && ex.name && ex.name.trim()) names.add(ex.name.trim());
		});
	});
	const current = select.value || '__all';
	select.innerHTML = '';
	const allOpt = document.createElement('option');
	allOpt.value = '__all';
	allOpt.textContent = 'All exercises';
	select.appendChild(allOpt);
	Array.from(names).sort().forEach(n => {
		const o = document.createElement('option');
		o.value = n;
		o.textContent = n;
		select.appendChild(o);
	});
	select.value = Array.from(select.querySelectorAll('option')).some(o => o.value === current) ? current : '__all';
}

// --------------------------------------------------------------------
// New unified chart system (single canvas)
// --------------------------------------------------------------------

function chartColors() {
	return settings.appearance === 'dark'
		? { grid: '#555', tick: '#ccc', legend: '#ddd' }
		: { grid: '#ddd', tick: '#333', legend: '#111' };
}

function buildProgressData(selected) {
	let labels = [];
	let difficultyData = [];
	let weightData = [];
	let durationData = [];
	let breakData = [];

	if (selected === '__all') {
		labels = workouts.map(w => w.date);
		difficultyData = workouts.map(w => {
			const exs = (w.exercises || []).filter(e => e.type !== 'break');
			if (!exs.length) return 0;
			const total = exs.reduce((sum, ex) => sum + (parseFloat(ex.difficulty || 0) || 0), 0);
			return total / exs.length;
		});
		weightData = workouts.map(w => {
			return (w.exercises || []).filter(e => e.type !== 'break').reduce((sum, ex) => {
				const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
				const reps = parseInt(ex.reps || 1) || 1;
				const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
				return sum + volume;
			}, 0);
		});
		durationData = workouts.map(w => w.totalTime || 0);
		breakData = workouts.map(w => {
			return (w.exercises || []).filter(e => e.type === 'break')
				.reduce((sum, br) => sum + (parseInt(br.time || br.duration || 0) || 0), 0);
		});
	} else {
		workouts.forEach(w => {
			const matches = (w.exercises || []).filter(ex => ex.type !== 'break' && ex.name && ex.name.trim() === selected);
			if (!matches.length) return;
			labels.push(w.date);
			const avgDiff = matches.reduce((s, ex) => s + (parseFloat(ex.difficulty || 0) || 0), 0) / matches.length;
			difficultyData.push(avgDiff);
			const totalVolume = matches.reduce((s, ex) => {
				const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
				const reps = parseInt(ex.reps || 1) || 1;
				const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
				return s + volume;
			}, 0);
			weightData.push(totalVolume);
			const duration = matches.reduce((s, ex) => s + (parseInt(ex.time || 0) || 0), 0);
			durationData.push(duration);
			let afters = [];
			const exs = w.exercises || [];
			for (let i = 0; i < exs.length; i++) {
				if (exs[i].type === 'exercise' && exs[i].name && exs[i].name.trim() === selected &&
					exs[i+1] && exs[i+1].type === 'break') {
					afters.push(parseInt(exs[i+1].time || exs[i+1].duration || 0) || 0);
				}
			}
			breakData.push(afters.length ? (afters.reduce((a,b)=>a+b,0)/afters.length) : 0);
		});
	}
	if (!labels.length) {
		labels = ['No data'];
		difficultyData = [0];
		weightData = [0];
		durationData = [0];
		breakData = [0];
	}
	return { labels, difficultyData, weightData, durationData, breakData };
}

function createOrUpdateProgressChart(type, labels, data, datasetLabel) {
	const canvas = document.getElementById('progressChart');
	if (!canvas) return;
	const colors = chartColors();
	const cfg = {
		type: 'line',
		data: { labels, datasets: [{
			label: datasetLabel, data,
			borderColor: 'rgb(38,115,255)',
			backgroundColor: 'rgba(38,115,255,0.1)',
			fill: true, tension: 0.2, pointRadius: 4
		}]},
		options: {
			responsive: true, maintainAspectRatio: false,
			scales: { x: { display: false, grid: { drawTicks:false, drawBorder:false } },
				y: { grid: { color: colors.grid }, ticks: { color: colors.tick } } },
			plugins: { legend: { labels: { color: colors.legend } },
				tooltip: { callbacks: { title: (ctx)=>labels[ctx[0].dataIndex] } } }
		}
	};
	if (type==='weight'){ cfg.data.datasets[0].borderColor='rgb(34,197,94)'; cfg.data.datasets[0].backgroundColor='rgba(34,197,94,0.1)';}
	else if(type==='duration'){cfg.data.datasets[0].borderColor='rgb(255,165,0)';cfg.data.datasets[0].backgroundColor='rgba(255,165,0,0.1)';}
	else if(type==='break'){cfg.data.datasets[0].borderColor='rgb(255,44,44)';cfg.data.datasets[0].backgroundColor='rgba(255,44,44,0.1)';}
	else {cfg.options.scales.y.suggestedMin=0;cfg.options.scales.y.suggestedMax=10;}

	if (progressChart) {
		progressChart.config.type = cfg.type;
		progressChart.config.data = cfg.data;
		progressChart.options = cfg.options;
		progressChart.update();
	} else {
		progressChart = new Chart(canvas.getContext('2d'), cfg);
	}
	setTimeout(() => {
		try {
			const panel = canvas.closest('.progress-panel');
			if (panel) panel.style.minHeight = canvas.clientHeight + 'px';
		} catch {}
	}, 60);
}

function renderProgress() {
	updateExerciseSelector();
	const selected = document.getElementById('exerciseSelect')?.value || '__all';
	const chartType = document.getElementById('chartSelect')?.value || 'difficulty';
	const d = buildProgressData(selected);
	let labels = d.labels, data = [], datasetLabel = '';

	if (chartType === 'difficulty') {
		data = d.difficultyData;
		datasetLabel = selected === '__all' ? 'Avg Difficulty (all exercises)' : `Avg Difficulty — ${selected}`;
	} else if (chartType === 'weight') {
		data = d.weightData;
		datasetLabel = selected === '__all' ? `Total Load (Volume) (${settings.defaultUnit})` : `Total Load — ${selected} (${settings.defaultUnit})`;
	} else if (chartType === 'duration') {
		data = d.durationData;
		datasetLabel = selected === '__all' ? 'Workout Duration (sec)' : `Duration — ${selected} (sec)`;
	} else if (chartType === 'break') {
		data = d.breakData;
		datasetLabel = selected === '__all' ? 'Total Break Time (sec)' : `Avg Break After — ${selected} (sec)`;
	}

	createOrUpdateProgressChart(chartType, labels, data, datasetLabel);

	// Ensure panel reserves space after Chart.js finishes layout
	setTimeout(() => {
		const canvas = document.getElementById('progressChart');
		const panel = canvas?.closest('.progress-panel');
		if (canvas && panel) {
			const h = canvas.clientHeight;
			if (h && h > 0) panel.style.minHeight = h + 'px';
		}
	}, 80);
}

// Keep chart responsive if canvas size changes
let panelResizeObserver = null;
function attachPanelResizeObserver() {
	const canvas = document.getElementById('progressChart');
	if (!canvas) return;
	if (panelResizeObserver) panelResizeObserver.disconnect();
	panelResizeObserver = new ResizeObserver(() => {
		if (progressChart) {
			try { progressChart.resize(); } catch (e) {}
		}
	});
	panelResizeObserver.observe(canvas);
}

// Initial wiring ------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
	applyAppearance();

	document.getElementById('settingsBtn').addEventListener('click', () => {
		document.getElementById('settingsModal').style.display = 'flex';
		document.getElementById('defaultUnit').value = settings.defaultUnit || 'kg';
		document.getElementById('appearance').value = settings.appearance || 'light';
	});
	document.getElementById('closeSettingsBtn').addEventListener('click', () => {
		document.getElementById('settingsModal').style.display = 'none';
	});
	document.getElementById('saveSettingsBtn').addEventListener('click', () => {
		settings.defaultUnit = document.getElementById('defaultUnit').value;
		settings.appearance = document.getElementById('appearance').value;
		persistSettings();
		applyAppearance();
		document.getElementById('settingsModal').style.display = 'none';
		renderProgress();
	});

	document.getElementById('addExerciseBtn').addEventListener('click', () => addExercise());
	document.getElementById('addBreakBtn').addEventListener('click', () => addBreak());
	document.getElementById('saveWorkoutBtn').addEventListener('click', saveWorkout);
	document.getElementById('startWorkoutBtn').addEventListener('click', startWorkout);
	document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

	document.getElementById('exerciseSelect').addEventListener('change', renderProgress);
	document.getElementById('chartSelect').addEventListener('change', renderProgress);

	renderHistory();
	updateExerciseSelector();
	renderProgress();
	attachPanelResizeObserver();
});
