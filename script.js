// script.js – rewritten, modernized, bug-fixed
'use strict';

/*
  Modern, single-file vanilla-js rewrite of the workout tracker behavior.

  - Keeps same storage keys and UI shape so it's compatible with index.html + style.css
  - Fixes break "skip" bug by tracking actual elapsed seconds on each break row
  - Cleaner separation of concerns, fewer globals, more helper functions
  - Uses const/let, arrow functions, and clearer variable naming
*/

const STORAGE_SETTINGS_KEY = 'wt_settings_v1';
const STORAGE_WORKOUTS_KEY = 'wt_workouts_v1';

// ---------- App state ----------
const App = {
	settings: JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY)) || { defaultUnit: 'kg', appearance: 'light' },
	workouts: JSON.parse(localStorage.getItem(STORAGE_WORKOUTS_KEY)) || [],
	editIndex: null,
	workoutStarted: false,
	workoutSeconds: 0,
	workoutTimerId: null,
	activeRowIndex: null,
	rowTimers: [],                // array of interval IDs (per row) or null
	charts: {
		difficulty: null,
		weight: null,
		duration: null,
		break: null
	},
	panelResizeObserver: null
};

// ---------- Utilities ----------
const fmtTime = secs => {
	const s = Math.max(0, parseInt(secs, 10) || 0);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
	const ss = (s % 60).toString().padStart(2, '0');
	return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};
const saveSettings = () => localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(App.settings));
const saveWorkouts = () => localStorage.setItem(STORAGE_WORKOUTS_KEY, JSON.stringify(App.workouts));
const escapeHtml = str => {
	if (str == null) return '';
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

// ---------- DOM helpers ----------
const $ = id => document.getElementById(id);
const create = (tag, props = {}, ...children) => {
	const el = document.createElement(tag);
	Object.entries(props).forEach(([k, v]) => {
		if (k === 'class') el.className = v;
		else if (k === 'html') el.innerHTML = v;
		else if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
		else el[k] = v;
	});
	children.forEach(c => { if (c == null) return; if (typeof c === 'string') el.appendChild(document.createTextNode(c)); else el.appendChild(c); });
	return el;
};

// ---------- Appearance ----------
function applyAppearance() {
	document.body.classList.toggle('dark', App.settings.appearance === 'dark');
}

// ---------- Row construction (Card-based) ----------
function ensureTimeCell(card) {
	let rail = card.querySelector('.card-action-rail');
	if (!rail) {
		rail = create('div', { class: 'card-action-rail' });
		card.prepend(rail);
	}
	let timeCell = rail.querySelector('.time-cell');
	if (!timeCell) {
		timeCell = create('div', { class: 'time-cell' });
		const display = create('span', { class: 'time-display', 'data-seconds': 0 }, fmtTime(0));
		timeCell.appendChild(display);
		rail.appendChild(timeCell); // <-- Appends to the end of the rail
	}
	return rail.querySelector('.time-display');
}

function createDoneButton(card) {
	let rail = card.querySelector('.card-action-rail');
	if (!rail) {
		rail = create('div', { class: 'card-action-rail' });
		card.prepend(rail);
	}
	
	// Remove existing button if any
	let oldBtn = rail.querySelector('.row-done-btn');
	if (oldBtn) oldBtn.remove();
	
	const btn = create('button', { type: 'button', class: 'row-done-btn', textContent: '✓' });
	btn.title = 'Mark done';
	btn.addEventListener('click', () => completeRow(card));
	rail.appendChild(btn); // <-- Appends to the end of the rail
	return btn;
}

function wireRowControls(card) {
	const slider = card.querySelector('.difficulty-slider');
	const sliderVal = card.querySelector('.difficulty-value');
	if (slider && sliderVal) slider.addEventListener('input', () => { sliderVal.textContent = slider.value; });

	const dropsetCb = card.querySelector('.dropset-checkbox');
	if (dropsetCb) dropsetCb.addEventListener('change', e => toggleDropSet(e.target));

	const repsInput = card.querySelector('.reps-field input[type="number"]');
	if (repsInput) repsInput.addEventListener('input', () => updateDropSetInputs(repsInput));
}

// Add exercise card
function addExercise(ex = {}) {
	const container = $('workoutListContainer');
	const card = create('div', { class: 'workout-card exercise-card' });

	// Create the rail and content wrapper
	const rail = create('div', { class: 'card-action-rail' });
	const contentWrapper = create('div', { class: 'card-content' });
	card.appendChild(rail);
	card.appendChild(contentWrapper);

	const name = escapeHtml(ex.name || '');
	const reps = ex.reps ?? 10;
	const difficulty = ex.difficulty ?? 5;
	const unit = (ex.unit || App.settings.defaultUnit) === 'kg' ? 'kg' : 'lbs';
	const dropset = !!ex.dropset;

	// Card structure (now goes into contentWrapper)
	let html = `
		<div class="card-header">
			<div class="card-title">
				<input type="text" class="exercise-name-input" placeholder="Exercise" value="${name}">
			</div>
		</div>
		<div class="card-body">
			<div class="card-row">
				<div class="card-field reps-field">
					<label>Reps</label>
					<input type="number" min="1" value="${reps}">
				</div>
				
				<div class="card-field weight-field">
					<label>Weight</label>
					<div class="weight-line">
						<input type="number" min="0" class="single-weight" value="${dropset ? '' : (Array.isArray(ex.weights) ? (ex.weights[0] ?? 0) : (ex.weight ?? 0))}">
						<select class="unit-select">
							<option value="kg"${unit === 'kg' ? ' selected' : ''}>kg</option>
							<option value="lbs"${unit === 'lbs' ? ' selected' : ''}>lbs</option>
						</select>
					</div>
				</div>
			</div>

			<div class="card-field dropset-field">
				<label class="dropset-label"><input type="checkbox" class="dropset-checkbox"${dropset ? ' checked' : ''}> dropset</label>
				<div class="dropset-inputs" style="display:${dropset ? '' : 'none'}"></div>
			</div>

			<div class="card-field diff-field">
				<label>Difficulty</label>
				<div class="difficulty-control">
					<input type="range" min="1" max="10" value="${difficulty}" class="difficulty-slider">
					<span class="difficulty-value">${difficulty}</span>
				</div>
			</div>
			
		</div>
	`;

	contentWrapper.innerHTML = html;

	// Add remove button to the rail
	const removeBtn = create('button', { type: 'button', class: 'row-remove-btn', textContent: 'X', title: 'Remove row' });
	removeBtn.addEventListener('click', () => card.remove());
	rail.appendChild(removeBtn); // <-- Appends removeBtn (RED) first

	if (App.workoutStarted) {
		ensureTimeCell(card); // Ensure time cell exists
		createDoneButton(card); // <-- Appends doneBtn (GREEN) second
		rail.classList.add('workout-active');
	}
	wireRowControls(card);

	if (dropset && Array.isArray(ex.weights) && ex.weights.length) {
		const cb = card.querySelector('.dropset-checkbox');
		if (cb) toggleDropSet(cb, ex.weights);
	}

	// restore time if provided
	if (ex.time != null) {
		ensureTimeCell(card); // <-- Appends timeCell (TIME) third
	}
	
	container.appendChild(card);
}

// Add break card
function addBreak(br = {}) {
	const container = $('workoutListContainer');
	const card = create('div', { class: 'workout-card break-card' });

	// Create the rail and content wrapper
	const rail = create('div', { class: 'card-action-rail' });
	const contentWrapper = create('div', { class: 'card-content' });
	card.appendChild(rail);
	card.appendChild(contentWrapper);

	const duration = parseInt(br.duration || br.plannedDuration || 60, 10) || 60;
	
	card.dataset.plannedDuration = duration;
	card._timeLeft = duration;
	card._elapsed = br.time != null ? parseInt(br.time, 10) || 0 : 0;
	card._countdown = null;

	let html = `
		<div class="card-body break-body">
			Break: <input type="number" min="1" value="${duration}"> sec
		</div>
	`;
	
	contentWrapper.innerHTML = html;
	
	const remBtn = create('button', { type: 'button', class: 'row-remove-btn', textContent: 'X', title: 'Remove break' });
	remBtn.addEventListener('click', () => card.remove());
	rail.appendChild(remBtn);

	if (App.workoutStarted) {
		ensureTimeCell(card); // Ensure time cell exists
		createDoneButton(card);
		rail.classList.add('workout-active');
	}
	
	// restore visible time cell if pre-filled
	if (br.time != null) {
		ensureTimeCell(card).dataset.seconds = card._elapsed;
		ensureTimeCell(card).textContent = fmtTime(card._elapsed);
	}
	
	container.appendChild(card);
}

// ---------- Dropset helpers ----------
function toggleDropSet(checkbox, restoreValues = []) {
	const card = checkbox.closest('.workout-card');
	if (!card) return;
	const dropsetContainer = card.querySelector('.dropset-inputs');
	const singleWeight = card.querySelector('.single-weight');
	const repsInput = card.querySelector('.reps-field input[type="number"]');
	if (dropsetContainer) dropsetContainer.innerHTML = '';

	if (checkbox.checked) {
		if (dropsetContainer) dropsetContainer.style.display = 'grid';
		if (singleWeight) singleWeight.style.display = 'none';
		const count = Math.max(1, parseInt(repsInput?.value || 1, 10));
		for (let i = 0; i < count; i++) {
			const w = create('input', { type: 'number', min: '0', value: (restoreValues[i] != null) ? restoreValues[i] : (i === 0 && singleWeight && singleWeight.value ? singleWeight.value : 0) });
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
	const card = repsInput.closest('.workout-card');
	if (!card) return;
	const dropsetCb = card.querySelector('.dropset-checkbox');
	if (!dropsetCb || !dropsetCb.checked) return;
	const container = card.querySelector('.dropset-inputs');
	const current = Array.from(container.querySelectorAll('input'));
	const newCount = Math.max(1, parseInt(repsInput.value || 1, 10));
	if (current.length < newCount) {
		const lastVal = current.length ? current[current.length - 1].value : 0;
		for (let i = current.length; i < newCount; i++) {
			const w = create('input', { type: 'number', min: '0', value: lastVal || 0 });
			container.appendChild(w);
		}
	} else if (current.length > newCount) {
		for (let i = current.length - 1; i >= newCount; i--) container.removeChild(current[i]);
	}
}

// ---------- Timers per row (stopwatch behavior) ----------
function startRowTimer(index) {
	const cards = Array.from($('workoutListContainer').children);
	if (index < 0 || index >= cards.length) return;
	if (App.activeRowIndex !== null && App.activeRowIndex !== index) stopRowTimer(App.activeRowIndex);

	const card = cards[index];
	const display = ensureTimeCell(card);
	let elapsed = parseInt(display.dataset.seconds || '0', 10) || 0;

	if (App.rowTimers[index]) clearInterval(App.rowTimers[index]);
	App.rowTimers[index] = setInterval(() => {
		elapsed++;
		display.dataset.seconds = elapsed;
		display.textContent = fmtTime(elapsed);
	}, 1000);

	App.activeRowIndex = index;
}

function stopRowTimer(index) {
	if (App.rowTimers[index]) {
		clearInterval(App.rowTimers[index]);
		App.rowTimers[index] = null;
	}
	if (App.activeRowIndex === index) App.activeRowIndex = null;
}

function computeTotalFromRows() {
	const cards = Array.from($('workoutListContainer').children);
	return cards.reduce((sum, r) => sum + (parseInt(r.querySelector('.time-display')?.dataset.seconds || '0', 10) || 0), 0);
}

// ---------- Workout global timer ----------
function startWorkoutTimer() {
	const display = $('workoutTotalTimer');
	App.workoutSeconds = 0;
	if (App.workoutTimerId) clearInterval(App.workoutTimerId);
	App.workoutTimerId = setInterval(() => {
		App.workoutSeconds++;
		display.textContent = 'Total Time: ' + fmtTime(App.workoutSeconds);
	}, 1000);
}
function stopWorkoutTimer() {
	if (App.workoutTimerId) {
		clearInterval(App.workoutTimerId);
		App.workoutTimerId = null;
	}
}

// ---------- Break countdowns (fixed) ----------
function startBreakCountdown(breakCard) {
	const cell = breakCard.querySelector('.break-body');
	if (!cell) return;

	const planned = parseInt(breakCard.dataset.plannedDuration || 0, 10) || 60;
	breakCard.dataset.plannedDuration = planned;

	// initialize runtime trackers if missing
	if (breakCard._timeLeft == null) breakCard._timeLeft = planned;
	if (breakCard._elapsed == null) breakCard._elapsed = 0;
	if (breakCard._countdown) {
		return; // already running
	}

	ensureTimeCell(breakCard); // ensure there's a time-display

	// clean the cell and build UI
	cell.innerHTML = '';
	const display = create('span', { class: 'break-countdown' });
	cell.appendChild(display);

	const btnAdd = create('button', { type: 'button', class: 'small', textContent: '+10s' });
	const btnSub = create('button', { type: 'button', class: 'small', textContent: '-10s' });
	const btnReset = create('button', { type: 'button', class: 'small', textContent: 'Reset' });
	const btnSkip = create('button', { type: 'button', class: 'small', textContent: 'Skip' });

	[btnAdd, btnSub, btnReset, btnSkip].forEach(b => {
		b.style.padding = '6px 8px';
		b.style.marginLeft = '6px';
		cell.appendChild(b);
	});

	const updateDisplay = () => {
		const left = breakCard._timeLeft;
		if (left <= 0) {
			display.textContent = 'Break complete!';
			breakCard.classList.remove('break-warning');
			breakCard.classList.add('break-done');

			// Hide done button on auto-complete
			const doneBtn = breakCard.querySelector('.row-done-btn');
			if (doneBtn) {
				doneBtn.style.display = 'none';
			}

			if (breakCard._countdown) {
				clearInterval(breakCard._countdown);
				breakCard._countdown = null;
			}

			// record actual elapsed seconds
			const timeDisplay = breakCard.querySelector('.time-display');
			if (timeDisplay) {
				timeDisplay.dataset.seconds = parseInt(breakCard._elapsed || 0, 10) || 0;
				timeDisplay.textContent = fmtTime(parseInt(breakCard._elapsed || 0, 10) || 0);
			}

			// move to next row
			const cards = Array.from($('workoutListContainer').children);
			const idx = cards.indexOf(breakCard);
			stopRowTimer(idx);
			if (idx + 1 < cards.length) {
				const next = cards[idx + 1];
				startRowTimer(idx + 1);
				if (next.classList.contains('break-card')) {
					const inp = next.querySelector('.break-body input[type="number"]');
					if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
					next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
					next._elapsed = 0;
					startBreakCountdown(next);
				}
			}
		} else {
			display.textContent = 'Break: ' + left + 's';
			if (left <= 10) breakCard.classList.add('break-warning');
			else breakCard.classList.remove('break-warning');
		}
	};

	const restartCountdown = () => {
		if (breakCard._timeLeft > 0 && !breakCard._countdown) {
			breakCard._countdown = setInterval(() => {
				breakCard._timeLeft = Math.max(0, breakCard._timeLeft - 1);
				breakCard._elapsed = (parseInt(breakCard._elapsed, 10) || 0) + 1;
				updateDisplay();
			}, 1000);
		}
	};

	btnAdd.addEventListener('click', () => {
		breakCard._timeLeft = (parseInt(breakCard._timeLeft, 10) || 0) + 10;
		updateDisplay();
		restartCountdown();
	});
	btnSub.addEventListener('click', () => {
		breakCard._timeLeft = Math.max(0, (parseInt(breakCard._timeLeft, 10) || 0) - 10);
		updateDisplay();
		restartCountdown();
	});
	btnReset.addEventListener('click', () => {
		breakCard._timeLeft = parseInt(breakCard.dataset.plannedDuration || 0, 10) || 0;
		breakCard._elapsed = 0;
		updateDisplay();
		restartCountdown();
	});

	btnSkip.addEventListener('click', () => {
		breakCard._timeLeft = 0;
		updateDisplay();
	});

	// initial render & start
	updateDisplay();
	restartCountdown();
}

// ---------- Completing a row (card) ----------
function completeRow(card) {
	const container = $('workoutListContainer');
	const cards = Array.from(container.children);
	const idx = cards.indexOf(card);
	if (idx < 0) return;

	if (card.classList.contains('break-card')) {
		if (card._countdown) {
			clearInterval(card._countdown);
			card._countdown = null;
		}
		card.classList.remove('break-warning');
		card.classList.add('break-done');

		// ensure the time display records proper elapsed seconds
		const td = card.querySelector('.time-display');
		if (td) {
			td.dataset.seconds = parseInt(card._elapsed || 0, 10) || 0;
			td.textContent = fmtTime(parseInt(card._elapsed || 0, 10) || 0);
		}
	} else {
		card.classList.add('exercise-done');
	}

	// Hide the done button
	const doneBtn = card.querySelector('.row-done-btn');
	if (doneBtn) {
		doneBtn.style.display = 'none';
	}

	stopRowTimer(idx);

	// start next card's timer and possibly a break
	if (idx + 1 < cards.length) {
		const next = cards[idx + 1];
		startRowTimer(idx + 1);
		if (next.classList.contains('break-card')) {
			const inp = next.querySelector('.break-body input[type="number"]');
			if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
			next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
			next._elapsed = 0;
			startBreakCountdown(next);
		}
	} else {
		// last row finished -> end workout
		endWorkout();
		const btn = $('startWorkoutBtn');
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
	}
}

// ---------- Start / End workout ----------
function startWorkout() {
	const btn = $('startWorkoutBtn');
	const container = $('workoutListContainer');
	const cards = Array.from(container.children);

	if (btn.dataset.active === 'true') {
		// End
		endWorkout();
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
		return;
	}

	if (!cards.length) {
		alert('Add at least one exercise first.');
		return;
	}

	document.body.classList.add('show-workout');

	cards.forEach(card => {
		// *** FIX: Ensure time cell exists FIRST to get correct DOM order ***
		ensureTimeCell(card); 
		
		// Show done button and activate split layout
		createDoneButton(card); // <-- Now appends *after* time cell
		const rail = card.querySelector('.card-action-rail');
		if (rail) rail.classList.add('workout-active');
	});

	btn.textContent = 'End';
	btn.dataset.active = 'true';
	btn.classList.add('end');
	$('workoutTotalTimer').style.display = 'block';
	$('workoutTotalTimer').textContent = 'Total Time: 00:00';
	App.workoutStarted = true;

	// start first card
	startRowTimer(0); // <-- This will now just find the existing time cell
	const first = cards[0];
	if (first && first.classList.contains('break-card')) {
		first.dataset.plannedDuration = parseInt(first.dataset.plannedDuration || 0, 10) || 0;
		first._timeLeft = parseInt(first.dataset.plannedDuration || 0, 10) || 0;
		first._elapsed = 0;
		startBreakCountdown(first);
	}

	startWorkoutTimer();
}

function endWorkout() {
	// stop all row timers
	App.rowTimers.forEach((id, i) => {
		if (id) stopRowTimer(i);
	});
	App.activeRowIndex = null;

	// clear break countdowns
	const cards = Array.from($('workoutListContainer').children);
	cards.forEach(card => {
		// Only reset the UI for breaks that were *in progress* but not finished
		if (card.classList.contains('break-card') && card._countdown && !card.classList.contains('break-done')) {
			clearInterval(card._countdown);
			card._countdown = null;
			const cell = card.querySelector('.break-body');
			const duration = card.dataset.plannedDuration || 60;
			if (cell) {
				cell.innerHTML = `Break: <input type="number" min="1" value="${duration}"> sec`;
			}
		}
	});

	stopWorkoutTimer();
	App.workoutStarted = false;

	// hide done buttons
	cards.forEach(card => {
		const doneBtn = card.querySelector('.row-done-btn');
		if (doneBtn) doneBtn.remove();
		const rail = card.querySelector('.card-action-rail');
		if (rail) rail.classList.remove('workout-active');
	});
}

// ---------- Save / Edit / Delete / Cancel ----------
function saveWorkout() {
	// end workout to freeze timers
	if (App.workoutStarted) {
		endWorkout();
	}

	const container = $('workoutListContainer');
	const cards = Array.from(container.children);
	if (!cards.length) { alert('Add at least one exercise!'); return; }

	const exercises = cards.map(card => {
		const td = card.querySelector('.time-display');
		const secs = parseInt(td?.dataset.seconds || 0, 10) || 0;

		if (card.classList.contains('break-card')) {
			const planned = parseInt(card.dataset.plannedDuration || 0, 10) || (parseInt(card.querySelector('.break-body input')?.value || 0, 10) || 0);
			return { type: 'break', duration: planned, time: secs };
		} else {
			const name = card.querySelector('.exercise-name-input')?.value || '';
			const reps = parseInt(card.querySelector('.reps-field input')?.value || 0, 10) || 0;
			let weights = [];
			if (card.querySelector('.dropset-checkbox')?.checked) {
				weights = Array.from(card.querySelectorAll('.dropset-inputs input')).map(i => i.value || 0);
			} else {
				weights = [card.querySelector('.single-weight')?.value || 0];
			}
			const unit = card.querySelector('.unit-select')?.value || App.settings.defaultUnit;
			const difficulty = parseInt(card.querySelector('.difficulty-slider')?.value || 0, 10) || 0;
			return {
				type: 'exercise',
				name,
				reps,
				weights,
				unit,
				dropset: !!card.querySelector('.dropset-checkbox')?.checked,
				difficulty,
				time: secs
			};
		}
	});

	// compute total time
	let totalTime = 0;
	if (App.workoutSeconds && App.workoutStarted) {
		totalTime = App.workoutSeconds;
	} else {
		totalTime = exercises.reduce((s, ex) => s + (parseInt(ex.time || 0, 10) || 0), 0);
	}

	if (App.editIndex != null) {
		App.workouts[App.editIndex].exercises = exercises;
		App.workouts[App.editIndex].date = new Date().toLocaleString();
		App.workouts[App.editIndex].totalTime = totalTime;
		App.editIndex = null;
		$('cancelEditBtn').style.display = 'none';
	} else {
		App.workouts.push({ date: new Date().toLocaleString(), exercises, totalTime });
	}

	saveWorkouts();
	renderHistory();
	updateExerciseSelector();
	renderProgress();

	// reset container
	$('workoutListContainer').innerHTML = '';

	App.workoutSeconds = 0;
	App.workoutStarted = false;
	$('workoutTotalTimer').style.display = 'none';
	document.body.classList.remove('show-workout');

	const btn = $('startWorkoutBtn');
	btn.textContent = 'Start';
	btn.dataset.active = 'false';
	btn.classList.remove('end');
}

function editWorkout(index) {
	const container = $('workoutListContainer');
	// reset container
	container.innerHTML = '';
	
	// If a workout is active, end it before loading another for editing.
	if (App.workoutStarted) {
		endWorkout();
		const btn = $('startWorkoutBtn');
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
	}

	const w = App.workouts[index];
	(w.exercises || []).forEach(ex => {
		if (ex.type === 'break') addBreak(ex);
		else addExercise(ex);
	});
	App.editIndex = index;
	$('cancelEditBtn').style.display = 'inline-block';
	$('workoutTotalTimer').style.display = 'block';
	$('workoutTotalTimer').textContent = 'Total Time: ' + fmtTime(w.totalTime || 0);

	// restore time displays
	const cards = Array.from($('workoutListContainer').children);
	cards.forEach((card, i) => {
		const original = (w.exercises || [])[i];
		if (!original) return;
		ensureTimeCell(card);
		const td = card.querySelector('.time-display');
		if (td) td.dataset.seconds = parseInt(original.time || 0, 10) || 0;
		if (card.classList.contains('break-card')) {
			card.dataset.plannedDuration = parseInt(original.duration || 0, 10) || 0;
			card._timeLeft = parseInt(original.duration || 0, 10) || 0;
			card._elapsed = parseInt(original.time || 0, 10) || 0;
		}
	});
}

function deleteWorkout(index) {
	if (!confirm('Are you sure you want to delete this workout?')) return;
	App.workouts.splice(index, 1);
	saveWorkouts();
	renderHistory();
	updateExerciseSelector();
	renderProgress();
}

function cancelEdit() {
	App.editIndex = null;
	$('cancelEditBtn').style.display = 'none';
	$('workoutListContainer').innerHTML = '';
	$('workoutTotalTimer').style.display = 'none';
	App.workoutStarted = false;
	App.workoutSeconds = 0;
}

// ---------- History & UI rendering (Card-based) ----------
function renderHistory() {
	const historyDiv = $('history');
	historyDiv.innerHTML = '';

	// show newest first
	App.workouts.slice().reverse().forEach((workout, i) => {
		const actualIndex = App.workouts.length - 1 - i;
		const div = create('div', { class: 'history-entry' });
		const strong = create('strong', {}, workout.date);
		const span = create('span', {}, ' Total Time: ' + fmtTime(workout.totalTime || 0));

		const editBtn = create('button', { class: 'edit-btn', textContent: 'Edit' });
		editBtn.addEventListener('click', () => {
			editWorkout(actualIndex);
			// Switch to planning tab
			document.querySelector('.tab-btn[data-target="main-panel"]').click();
		});

		const delBtn = create('button', { class: 'delete-btn', textContent: 'Delete' });
		delBtn.addEventListener('click', () => deleteWorkout(actualIndex));

		// container for exercise cards
		const exContainer = create('div', { class: 'history-exercise-list' });

		(workout.exercises || []).forEach(ex => {
			const card = create('div', { class: 'history-card' });
			if (ex.type === 'break') {
				card.classList.add('break-card');
				card.innerHTML = `
					<div class="hist-time">${fmtTime(ex.time || 0)}</div>
					<div class="hist-details" style="text-align:center; font-style:italic;">
						Break: ${ex.duration || 0} sec
					</div>
				`;
			} else {
				card.classList.add('exercise-card');
				const repsDisplay = ex.reps || 0;
				const weightsDisplay = ex.dropset ? (Array.isArray(ex.weights) ? ex.weights.join(' → ') : ex.weights) : (Array.isArray(ex.weights) ? ex.weights[0] : ex.weights);
				const unit = ex.unit || App.settings.defaultUnit;
				const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
				
				const statsItems = [];
				statsItems.push(`<span><strong>Reps:</strong> ${escapeHtml(String(repsDisplay))}</span>`);
		
				// Check if all weights are effectively zero
				const allWeightsZero = !ex.weights || !Array.isArray(ex.weights) || ex.weights.every(w => (parseFloat(w) || 0) === 0);
		
				// Change 1, 2, 3: Only add weight span if not zero, use "Weight", and omit "(dropset)"
				if (!allWeightsZero) {
					statsItems.push(`<span><strong>Weight:</strong> ${escapeHtml(String(weightsDisplay || '0'))} ${escapeHtml(unit)}</span>`);
				}
		
				statsItems.push(`<span><strong>Diff:</strong> ${escapeHtml(String(difficultyDisplay))}/10</span>`);
				
				card.innerHTML = `
					<div class="hist-time">${fmtTime(ex.time || 0)}</div>
					<div class="hist-details">
						<strong class="hist-name">${escapeHtml(ex.name || '')}</strong>
						<div class="hist-stats">
							${statsItems.join('\n')}
						</div>
					</div>
				`;
			}
			exContainer.appendChild(card);
		});

		div.appendChild(strong);
		div.appendChild(span);
		div.appendChild(editBtn);
		div.appendChild(delBtn);
		div.appendChild(exContainer); // Add card container
		historyDiv.appendChild(div);
	});
}

function updateExerciseSelector() {
	const select = $('exerciseSelect');
	if (!select) return;
	const names = new Set();
	App.workouts.forEach(w => {
		(w.exercises || []).forEach(ex => {
			if (ex.type === 'exercise' && ex.name && ex.name.trim()) names.add(ex.name.trim());
		});
	});
	const current = select.value || '__all';
	select.innerHTML = '';
	const allOpt = create('option', { value: '__all', textContent: 'All exercises' });
	select.appendChild(allOpt);
	Array.from(names).sort().forEach(n => {
		const o = create('option', { value: n, textContent: n });
		select.appendChild(o);
	});
	select.value = Array.from(select.querySelectorAll('option')).some(o => o.value === current) ? current : '__all';
}

// ---------- Progress charting (Updated for multiple charts) ----------
function chartColors() {
	return App.settings.appearance === 'dark' ? { grid: '#555', tick: '#ccc', legend: '#ddd' } : { grid: '#ddd', tick: '#333', legend: '#111' };
}

function buildProgressData(selected) {
	let labels = [], difficultyData = [], weightData = [], durationData = [], breakData = [];

	if (selected === '__all') {
		labels = App.workouts.map(w => w.date);
		difficultyData = App.workouts.map(w => {
			const exs = (w.exercises || []).filter(e => e.type !== 'break');
			if (!exs.length) return 0;
			const total = exs.reduce((sum, ex) => sum + (parseFloat(ex.difficulty || 0) || 0), 0);
			return total / exs.length;
		});
		weightData = App.workouts.map(w => {
			return (w.exercises || []).filter(e => e.type !== 'break').reduce((sum, ex) => {
				const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
				const reps = parseInt(ex.reps || 1, 10) || 1;
				const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
				return sum + volume;
			}, 0);
		});
		durationData = App.workouts.map(w => w.totalTime || 0);
		breakData = App.workouts.map(w => {
			return (w.exercises || []).filter(e => e.type === 'break').reduce((sum, br) => sum + (parseInt(br.time || br.duration || 0, 10) || 0), 0);
		});
	} else {
		App.workouts.forEach(w => {
			const matches = (w.exercises || []).filter(ex => ex.type !== 'break' && ex.name && ex.name.trim() === selected);
			if (!matches.length) return;
			labels.push(w.date);
			const avgDiff = matches.reduce((s, ex) => s + (parseFloat(ex.difficulty || 0) || 0), 0) / matches.length;
			difficultyData.push(avgDiff);
			const totalVolume = matches.reduce((s, ex) => {
				const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
				const reps = parseInt(ex.reps || 1, 10) || 1;
				const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
				return s + volume;
			}, 0);
			weightData.push(totalVolume);
			const duration = matches.reduce((s, ex) => s + (parseInt(ex.time || 0, 10) || 0), 0);
			durationData.push(duration);
			let afters = [];
			const exs = w.exercises || [];
			for (let i = 0; i < exs.length; i++) {
				if (exs[i].type === 'exercise' && exs[i].name && exs[i].name.trim() === selected && exs[i + 1] && exs[i + 1].type === 'break') {
					afters.push(parseInt(exs[i + 1].time || exs[i + 1].duration || 0, 10) || 0);
				}
			}
			breakData.push(afters.length ? (afters.reduce((a, b) => a + b, 0) / afters.length) : 0);
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

function createOrUpdateChart(chartId, type, labels, data, datasetLabel) {
	const canvas = $(chartId);
	if (!canvas) return;
	const colors = chartColors();
	const cfg = {
		type: 'line',
		data: {
			labels,
			datasets: [{
				label: datasetLabel,
				data,
				borderColor: 'rgb(38,115,255)',
				backgroundColor: 'rgba(38,115,255,0.1)',
				fill: true,
				tension: 0.2,
				pointRadius: 4
			}]
		},
		options: {
			responsive: true, maintainAspectRatio: true,
			scales: { x: { display: false, grid: { drawTicks: false, drawBorder: false } }, y: { grid: { color: colors.grid }, ticks: { color: colors.tick } } },
			plugins: { legend: { labels: { color: colors.legend } }, tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } } }
		}
	};
	if (type === 'weight') { cfg.data.datasets[0].borderColor = 'rgb(34,197,94)'; cfg.data.datasets[0].backgroundColor = 'rgba(34,197,94,0.1)'; }
	else if (type === 'duration') { cfg.data.datasets[0].borderColor = 'rgb(255,165,0)'; cfg.data.datasets[0].backgroundColor = 'rgba(255,165,0,0.1)'; }
	else if (type === 'break') { cfg.data.datasets[0].borderColor = 'rgb(255,44,44)'; cfg.data.datasets[0].backgroundColor = 'rgba(255,44,44,0.1)'; }
	else { cfg.options.scales.y.suggestedMin = 0; cfg.options.scales.y.suggestedMax = 10; }

	if (App.charts[type]) {
		App.charts[type].config.type = cfg.type;
		App.charts[type].config.data = cfg.data;
		App.charts[type].options = cfg.options;
		App.charts[type].update();
	} else {
		App.charts[type] = new Chart(canvas.getContext('2d'), cfg);
	}
}

function renderProgress() {
	updateExerciseSelector();
	const selected = $('exerciseSelect')?.value || '__all';
	const d = buildProgressData(selected);

	// Difficulty chart
	createOrUpdateChart(
		'difficultyChart',
		'difficulty',
		d.labels,
		d.difficultyData,
		selected === '__all' ? 'Avg Difficulty (all exercises)' : `Avg Difficulty — ${selected}`
	);

	// Weight chart
	createOrUpdateChart(
		'weightChart',
		'weight',
		d.labels,
		d.weightData,
		selected === '__all' ? `Total Load (Volume) (${App.settings.defaultUnit})` : `Total Load — ${selected} (${App.settings.defaultUnit})`
	);

	// Duration chart
	createOrUpdateChart(
		'durationChart',
		'duration',
		d.labels,
		d.durationData,
		selected === '__all' ? 'Workout Duration (sec)' : `Duration — ${selected} (sec)`
	);

	// Break chart
	createOrUpdateChart(
		'breakChart',
		'break',
		d.labels,
		d.breakData,
		selected === '__all' ? 'Total Break Time (sec)' : `Avg Break After — ${selected} (sec)`
	);
}

function attachPanelResizeObserver() {
	const canvases = ['difficultyChart', 'weightChart', 'durationChart', 'breakChart'].map(id => $(id)).filter(c => c);
	if (!canvases.length) return;
	if (App.panelResizeObserver) App.panelResizeObserver.disconnect();
	App.panelResizeObserver = new ResizeObserver(() => {
		Object.values(App.charts).forEach(chart => {
			if (chart) {
				try { chart.resize(); } catch (e) { /* ignore */ }
			}
		});
	});
	canvases.forEach(canvas => App.panelResizeObserver.observe(canvas));
}

// ---------- Init & wiring ----------
document.addEventListener('DOMContentLoaded', () => {
	applyAppearance();

	// settings panel - load current values and auto-save on change
	$('defaultUnit').value = App.settings.defaultUnit || 'kg';
	$('appearance').value = App.settings.appearance || 'light';
	
	$('defaultUnit').addEventListener('change', () => {
		App.settings.defaultUnit = $('defaultUnit').value;
		saveSettings();
		renderProgress();
	});
	
	$('appearance').addEventListener('change', () => {
		App.settings.appearance = $('appearance').value;
		saveSettings();
		applyAppearance();
		renderProgress();
	});

	// main buttons
	$('addExerciseBtn').addEventListener('click', () => addExercise());
	$('addBreakBtn').addEventListener('click', () => addBreak());
	$('saveWorkoutBtn').addEventListener('click', saveWorkout);
	$('startWorkoutBtn').addEventListener('click', startWorkout);
	$('cancelEditBtn').addEventListener('click', cancelEdit);

	// progress filters
	$('exerciseSelect').addEventListener('change', renderProgress);

	// initial render
	renderHistory();
	updateExerciseSelector();
	renderProgress();
	attachPanelResizeObserver();

	// tabs
	const tabButtons = document.querySelectorAll('.tab-btn');
	const panels = document.querySelectorAll('.main-panel, .progress-panel, .history-panel, .settings-panel');
	tabButtons.forEach(btn => {
		btn.addEventListener('click', () => {
			tabButtons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			panels.forEach(p => p.classList.remove('active'));
			const targetPanel = document.querySelector('.' + btn.dataset.target);
			if (targetPanel) targetPanel.classList.add('active');
			
			// Re-render progress charts if its tab is selected
			if (btn.dataset.target === 'progress-panel') {
				setTimeout(() => {
					Object.values(App.charts).forEach(chart => {
						if (chart) chart.resize();
					});
				}, 50);
			}
		});
	});
});