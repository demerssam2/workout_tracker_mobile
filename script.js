// script.js
// Tabs used for indentation throughout.
// Full working workout logic for mobile-first UI.
// - Start/End workout (Start toggles to End)
// - Done column is first column and shown only while running
// - Break rows are single colspan cells when not running; become countdown UI when running
// - Breaks auto-start when previous row completes
// - Add Exercise / Add Break available while running
// - Save to localStorage, history, edit/delete, preserve times across edits
// - Dropset support preserved (multiple weight inputs)
// - Difficulty sliders preserved
// - Charts (Chart.js) updated via renderProgress()
// - Settings modal (units & appearance) persisted
// Uses only addEventListener wiring (no inline onclick)

'use strict';

const STORAGE_SETTINGS_KEY = 'wt_settings_v1';
const STORAGE_WORKOUTS_KEY = 'wt_workouts_v1';

let settings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY)) || { defaultUnit: 'kg', appearance: 'light' };
let workouts = JSON.parse(localStorage.getItem(STORAGE_WORKOUTS_KEY)) || [];
let editIndex = null;

// Charts
let difficultyChart = null;
let weightChart = null;

// Runtime timers/state
let workoutStarted = false;
let workoutSeconds = 0;
let workoutTimer = null;

let activeRowIndex = null; // index (0-based among body rows) of currently running row stopwatch
let rowTimers = [];		// interval ids for per-row stopwatches
// For break countdowns we store breakRow._countdown as interval id and breakRow._timeLeft as seconds remaining

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
	// ensure first cell exists (done-col-cell) and contains a button
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
	// difficulty slider update
	const slider = row.querySelector('.difficulty-slider');
	const sliderValue = row.querySelector('.difficulty-value');
	if (slider && sliderValue) {
		slider.addEventListener('input', () => {
			sliderValue.textContent = slider.value;
		});
	}

	// dropset toggle
	const dropsetCb = row.querySelector('.dropset-checkbox');
	if (dropsetCb) {
		dropsetCb.addEventListener('change', (e) => toggleDropSet(e.target));
	}

	// reps change may affect dropset inputs
	const repsInput = row.querySelector('.reps-cell input[type="number"]');
	if (repsInput) {
		repsInput.addEventListener('input', () => updateDropSetInputs(repsInput));
	}
}

// Add exercise / break ------------------------------------------------
function addExercise(ex = {}) {
    const table = document.getElementById('workoutTable');
    const row = table.insertRow(-1);
    row.className = 'exercise-row';

    // Only add done-col-cell if workoutStarted (✓ header is present)
    let rowHtml = '';
    if (workoutStarted) {
        rowHtml += '<td class="done-col-cell"></td>';
    }
    rowHtml += '\
        <td class="exercise-cell"><input type="text" placeholder="Exercise" value="' + escapeHtml(ex.name || '') + '"></td>\
        <td class="sets-cell"><input type="number" min="1" value="' + (ex.sets || 3) + '"></td>\
        <td class="reps-cell"><input type="number" min="1" value="' + (ex.reps ?? 10) + '"></td>\
        <td class="weight-cell">\
            <div class="weight-line">\
                <input type="number" min="0" class="single-weight" value="' + (ex.dropset ? '' : (Array.isArray(ex.weights) ? (ex.weights[0] ?? 0) : (ex.weight ?? 0))) + '">\
                <select class="unit-select">\
                    <option value="kg"' + ((ex.unit || settings.defaultUnit) === 'kg' ? ' selected' : '') + '>kg</option>\
                    <option value="lbs"' + ((ex.unit || settings.defaultUnit) === 'lbs' ? ' selected' : '') + '>lbs</option>\
                </select>\
                <label style="font-size:12px;"><input type="checkbox" class="dropset-checkbox"' + (ex.dropset ? ' checked' : '') + '> dropset</label>\
            </div>\
            <div class="dropset-inputs" style="display:' + (ex.dropset ? '' : 'none') + ';"></div>\
        </td>\
        <td class="difficulty-cell">\
            <input type="range" min="1" max="10" value="' + (ex.difficulty || 5) + '" class="difficulty-slider">\
            <span class="difficulty-value">' + (ex.difficulty || 5) + '</span>\
        </td>\
        <td class="notes-cell"><input type="text" placeholder="Notes" value="' + escapeHtml(ex.notes || '') + '"></td>\
        <td class="remove-col"></td>';
    row.innerHTML = rowHtml;

    // remove button
    const removeCell = row.querySelector('.remove-col');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove-btn';
    removeBtn.textContent = 'X';
    removeBtn.title = 'Remove row';
    removeBtn.addEventListener('click', () => row.remove());
    removeCell.appendChild(removeBtn);

    // done button cell and behaviour
    if (workoutStarted) createDoneButtonForRow(row);

    addRowListeners(row);

    // if this exercise had dropset values provided, populate them
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
    if (workoutStarted) {
        rowHtml += '<td class="done-col-cell"></td>';
    }
    const colspan = workoutStarted ? 7 : 7; // keep colspan same, header is dynamic
    rowHtml += '\
        <td class="break-cell" colspan="' + colspan + '" style="text-align:center;">\
            Break: <input type="number" min="1" value="' + duration + '"> sec\
        </td>';
    row.innerHTML = rowHtml;

    // append remove control to the break-cell so users can remove break easily
    const breakCell = row.querySelector('.break-cell');
    const remBtn = document.createElement('button');
    remBtn.type = 'button';
    remBtn.className = 'row-remove-btn';
    remBtn.textContent = 'X';
    remBtn.title = 'Remove break';
    remBtn.style.marginLeft = '8px';
    remBtn.addEventListener('click', () => row.remove());
    breakCell.appendChild(remBtn);

    // keep plannedDuration in dataset
    row.dataset.plannedDuration = duration;

    // create done button cell for uniformity (hidden until running)
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
		for (let i = current.length - 1; i >= newCount; i--) {
			container.removeChild(current[i]);
		}
	}
}

// Row stopwatch / timers ---------------------------------------------
function ensureTimeDisplayOnRow(row) {
	// add a hidden td holding .time-display which stores dataset.seconds
	if (!row.querySelector('.time-display')) {
		const td = document.createElement('td');
		td.style.display = 'none';
		td.className = 'time-cell';
		const existing = row.dataset._time || 0;
		td.innerHTML = '<span class="time-display" data-seconds="' + (existing) + '">' + formatTime(existing) + '</span>';
		row.appendChild(td);
	}
}

function startRowTimer(index) {
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	if (index < 0 || index >= rows.length) return;

	// stop other
	if (activeRowIndex !== null && activeRowIndex !== index) {
		stopRowTimer(activeRowIndex);
	}

	const row = rows[index];
	ensureTimeDisplayOnRow(row);
	const display = row.querySelector('.time-display');
	if (!display) return;

	let elapsed = parseInt(display.dataset.seconds || '0') || 0;
	// clear any prior interval
	if (rowTimers[index]) clearInterval(rowTimers[index]);

	rowTimers[index] = setInterval(() => {
		elapsed++;
		display.dataset.seconds = elapsed;
		display.textContent = formatTime(elapsed);
		// if row is break-row and also running as countdown we don't modify break countdown here
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
	// breakRow must have .break-cell (td with colspan). We replace its inner with countdown UI.
	const cell = breakRow.querySelector('.break-cell');
	if (!cell) return;
	// planned duration stored in dataset
	let planned = parseInt(breakRow.dataset.plannedDuration || 0) || 0;
	if (!planned) planned = 60;
	breakRow.dataset.plannedDuration = planned;

	// If the row already has an active countdown, don't recreate it; restart should be idempotent.
	if (breakRow._countdown) {
		// already counting down
		return;
	}

	// Ensure a time-display exists (to be used for total/per-row time)
	ensureTimeDisplayOnRow(breakRow);

	// convert existing timeSpent stored in .time-display into elapsed variable for the break (we want countdown, not stopwatch)
	// We'll use breakRow._timeLeft to track remaining seconds.
	if (breakRow._timeLeft == null) {
		// initialize from planned (first start)
		breakRow._timeLeft = planned;
	}

	// Build UI
	cell.innerHTML = '';
	const display = document.createElement('span');
	display.className = 'break-countdown';
	cell.appendChild(display);

	const btnAdd = document.createElement('button'); btnAdd.type = 'button'; btnAdd.className = 'small'; btnAdd.textContent = '+10s';
	const btnSub = document.createElement('button'); btnSub.type = 'button'; btnSub.className = 'small'; btnSub.textContent = '-10s';
	const btnReset = document.createElement('button'); btnReset.type = 'button'; btnReset.className = 'small'; btnReset.textContent = 'Reset';
	const btnSkip = document.createElement('button'); btnSkip.type = 'button'; btnSkip.className = 'small'; btnSkip.textContent = 'Skip';

	// small styling inline for tight layout
	[btnAdd, btnSub, btnReset, btnSkip].forEach(b => {
		b.style.padding = '6px 8px';
		b.style.marginLeft = '6px';
	});

	cell.appendChild(btnAdd);
	cell.appendChild(btnSub);
	cell.appendChild(btnReset);
	cell.appendChild(btnSkip);

	// update UI function
	function updateDisplay() {
		const left = breakRow._timeLeft;
		if (left <= 0) {
			display.textContent = 'Break complete!';
			breakRow.classList.remove('break-warning');
			breakRow.classList.add('break-done');
			// stop countdown interval
			if (breakRow._countdown) {
				clearInterval(breakRow._countdown);
				breakRow._countdown = null;
			}
			// Also mark the underlying stopwatch value for this break row as elapsed/planned
			const timeDisplay = breakRow.querySelector('.time-display');
			if (timeDisplay) {
				// store total seconds elapsed for this break as planned (so saved workouts show correct time)
				timeDisplay.dataset.seconds = (parseInt(timeDisplay.dataset.seconds || 0) || 0) + parseInt(breakRow.dataset.plannedDuration || 0);
			}
			// stop the stopwatch for this row (if any) and start next row
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

	// restart countdown if not running
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

	// start initial display
	updateDisplay();
	restartCountdown();
}

// Completing a row ----------------------------------------------------
function completeRow(row) {
	const table = document.getElementById('workoutTable');
	const rows = Array.from(table.rows).slice(1);
	const idx = rows.indexOf(row);
	if (idx < 0) return;

	// mark visual state
	if (row.classList.contains('break-row')) {
		// if break had a countdown, clear it
		if (row._countdown) {
			clearInterval(row._countdown);
			row._countdown = null;
		}
		row.classList.remove('break-warning');
		row.classList.add('break-done');
	} else {
		row.classList.add('exercise-done');
	}

	// stop any row stopwatch
	stopRowTimer(idx);

	// move to next row
	if (idx + 1 < rows.length) {
		const next = rows[idx + 1];
		startRowTimer(idx + 1);
		// if next is break, start its countdown (only when it's next to run)
		if (next.classList.contains('break-row')) {
			// initialize plannedDuration from input if still present
			const inp = next.querySelector('.break-cell input[type="number"]');
			if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0) || 0;
			// set breakRow._timeLeft to its planned value
			next._timeLeft = parseInt(next.dataset.plannedDuration || 0) || 0;
			startBreakCountdown(next);
		}
	} else {
		// finished workout sequence
		endWorkout(); // stops timers, but preserves visual states
		// adjust Start button state
		const btn = document.getElementById('startWorkoutBtn');
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end'); // <-- FIX: Remove red style
		document.body.classList.remove('show-workout');
	}
}

// Start / End workout -------------------------------------------------
function startWorkout() {
    const btn = document.getElementById('startWorkoutBtn');
    const table = document.getElementById('workoutTable');
    const rows = Array.from(table.rows).slice(1);

    // toggle end
    if (btn.dataset.active === 'true') {
        // end
        endWorkout();
        btn.textContent = 'Start';
        btn.dataset.active = 'false';
        btn.classList.remove('end'); // <-- Remove red style
        document.body.classList.remove('show-workout');
        // Remove ✓ column header when workout ends
        const header = document.querySelector('#headerRow .done-col');
        if (header) header.remove();

        // Remove done-col-cell from all rows
        const table = document.getElementById('workoutTable');
        Array.from(table.rows).forEach(row => {
            const doneCell = row.querySelector('.done-col-cell');
            if (doneCell) doneCell.remove();
        });
        return;
    }

    // start
    if (!rows.length) {
        alert('Add at least one exercise first.');
        return;
    }

    // reveal done column/buttons
    document.body.classList.add('show-workout');
    // Add ✓ column header dynamically when starting
    const header = document.querySelector('#headerRow');
    if (header && !header.querySelector('.done-col')) {
        const th = document.createElement('th');
        th.className = 'done-col';
        th.textContent = '✓';
        header.insertBefore(th, header.firstChild);
    }

    // Add done-col-cell to all rows if missing
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
    btn.classList.add('end'); // <-- Add red style
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
    // stop all per-row timers
    rowTimers.forEach((id, i) => { if (id) clearInterval(id); rowTimers[i] = null; });
	activeRowIndex = null;

	// stop global timer
	stopWorkoutTimer();

	// stop all break countdowns
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	rows.forEach(r => {
		if (r._countdown) { clearInterval(r._countdown); r._countdown = null; }
		r.classList.remove('break-warning');
	});

	workoutStarted = false;
	// hide done buttons
	rows.forEach(r => {
		const doneBtn = r.querySelector('.done-col-cell button');
		if (doneBtn) doneBtn.style.display = 'none';
	});
}

// Save / Edit / Delete / Cancel ---------------------------------------
function saveWorkout() {
	// gather rows into exercises array
	endWorkout(); // stop running timers so saved times are consistent

	const table = document.getElementById('workoutTable');
	const rows = Array.from(table.rows).slice(1);
	if (!rows.length) { alert('Add at least one exercise!'); return; }

	const exercises = rows.map(r => {
		// ensure we capture time-display seconds for each row
		const td = r.querySelector('.time-display');
		const secs = parseInt(td?.dataset.seconds || 0) || 0;

		if (r.classList.contains('break-row')) {
			const planned = parseInt(r.dataset.plannedDuration || 0) || (parseInt(r.querySelector('.break-cell input')?.value || 0) || 0);
			return { type: 'break', duration: planned, time: secs };
		} else {
			const name = r.querySelector('.exercise-cell input')?.value || '';
			const sets = parseInt(r.querySelector('.sets-cell input')?.value || 0) || 0;
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
				sets,
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

	// reset table to header only
    const headerHtml = document.getElementById('workoutTable').rows[0].outerHTML;
    document.getElementById('workoutTable').innerHTML = headerHtml;

    workoutSeconds = 0;
    workoutStarted = false;
    document.getElementById('workoutTotalTimer').style.display = 'none';
    document.body.classList.remove('show-workout');

    // FIX: Ensure Start button is green after save
    const btn = document.getElementById('startWorkoutBtn');
    btn.textContent = 'Start';
    btn.dataset.active = 'false';
    btn.classList.remove('end');
}

function editWorkout(index) {
	const table = document.getElementById('workoutTable');
	// reset table to header
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

	// restore per-row recorded times (if any) into .time-display dataset so they persist when edited and saved
	const rows = Array.from(document.getElementById('workoutTable').rows).slice(1);
	rows.forEach((r, i) => {
		const original = (w.exercises || [])[i];
		if (!original) return;
		ensureTimeDisplayOnRow(r);
		const td = r.querySelector('.time-display');
		if (td) td.dataset.seconds = original.time || 0;
		// for breaks, ensure plannedDuration and _timeLeft
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
			<th>Sets x Reps</th>\
			<th>Weight</th>\
			<th>Difficulty</th>\
			<th>Notes</th>';
		table.appendChild(thead);

		(workout.exercises || []).forEach(ex => {
			const tr = document.createElement('tr');
			if (ex.type === 'break') {
				tr.innerHTML = '<td>' + formatTime(ex.time || 0) + '</td><td colspan="5" style="text-align:center; font-style:italic;">Break: ' + (ex.duration || 0) + ' sec</td>';
			} else {
				const repsDisplay = (ex.sets || 0) + 'x' + (ex.reps || 0);
				const weightsDisplay = ex.dropset ? (Array.isArray(ex.weights) ? ex.weights.join(' → ') : ex.weights) : (Array.isArray(ex.weights) ? ex.weights[0] : ex.weights);
				const unit = ex.unit || settings.defaultUnit;
				const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
				tr.innerHTML = '<td>' + formatTime(ex.time || 0) + '</td>' +
					'<td>' + escapeHtml(ex.name || '') + '</td>' +
					'<td>' + escapeHtml(repsDisplay) + '</td>' +
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

function chartColors() {
	return settings.appearance === 'dark'
		? { grid: '#555', tick: '#ccc', legend: '#ddd' }
		: { grid: '#ddd', tick: '#333', legend: '#111' };
}

function renderProgress() {
	updateExerciseSelector();
	const selected = document.getElementById('exerciseSelect')?.value || '__all';
	let labels = [];
	let difficultyData = [];
	let weightData = [];

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
				const weightPerSet = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0);
				return sum + weightPerSet * (parseInt(ex.sets || 1) || 1);
			}, 0);
		});
	} else {
		workouts.forEach(w => {
			const matches = (w.exercises || []).filter(ex => ex.type !== 'break' && ex.name && ex.name.trim() === selected);
			if (!matches.length) return;
			labels.push(w.date);
			const avgDiff = matches.reduce((s, ex) => s + (parseFloat(ex.difficulty || 0) || 0), 0) / matches.length;
			difficultyData.push(avgDiff);
			const totalW = matches.reduce((s, ex) => {
				const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
				const weightPerSet = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0);
				return s + weightPerSet * (parseInt(ex.sets || 1) || 1);
			}, 0);
			weightData.push(totalW);
		});
	}

	if (!labels.length) {
		labels = ['No data'];
		difficultyData = [0];
		weightData = [0];
	}

	if (difficultyChart) difficultyChart.destroy();
	if (weightChart) weightChart.destroy();

	const colors = chartColors();
	const ctx1 = document.getElementById('difficultyChart').getContext('2d');
	difficultyChart = new Chart(ctx1, {
		type: 'line',
		data: {
			labels,
			datasets: [{
				label: selected === '__all' ? 'Avg Difficulty (all exercises)' : `Avg Difficulty — ${selected}`,
				data: difficultyData,
				borderColor: 'rgb(38,115,255)',
				backgroundColor: 'rgba(38,115,255,0.1)',
				fill: true,
				tension: 0.2,
				pointRadius: 4
			}]
		},
		options: {
			responsive: true,
			scales: {
				x: { display: false, grid: { drawTicks: false, drawBorder: false } },
				y: { suggestedMin: 0, suggestedMax: 10, grid: { color: colors.grid }, ticks: { color: colors.tick } }
			},
			plugins: {
				legend: { labels: { color: colors.legend } },
				tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } }
			}
		}
	});

	const ctx2 = document.getElementById('weightChart').getContext('2d');
	weightChart = new Chart(ctx2, {
		type: 'line',
		data: {
			labels,
			datasets: [{
				label: selected === '__all' ? `Total Weight Lifted (${settings.defaultUnit})` : `Total Weight — ${selected} (${settings.defaultUnit})`,
				data: weightData,
				borderColor: 'rgb(34,197,94)',
				backgroundColor: 'rgba(34,197,94,0.1)',
				fill: true,
				tension: 0.2,
				pointRadius: 4
			}]
		},
		options: {
			responsive: true,
			scales: {
				x: { display: false, grid: { drawTicks: false, drawBorder: false } },
				y: { grid: { color: colors.grid }, ticks: { color: colors.tick } }
			},
			plugins: {
				legend: { labels: { color: colors.legend } },
				tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } }
			}
		}
	});
}

// Initial wiring ------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
	// settings modal wiring
	applyAppearance();
	document.getElementById('settingsBtn').addEventListener('click', () => {
		document.getElementById('settingsModal').style.display = 'flex';
		// populate current values
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

	// main buttons
	document.getElementById('addExerciseBtn').addEventListener('click', () => addExercise());
	document.getElementById('addBreakBtn').addEventListener('click', () => addBreak());
	document.getElementById('saveWorkoutBtn').addEventListener('click', saveWorkout);
	document.getElementById('startWorkoutBtn').addEventListener('click', startWorkout);
	document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

	// history selector
	document.getElementById('exerciseSelect').addEventListener('change', renderProgress);

	// restore existing workouts into history
	renderHistory();
	updateExerciseSelector();
	renderProgress();
});