'use strict';

// ==========================================================================
//  Constants
// ==========================================================================

const STORAGE_SETTINGS_KEY = 'wt_settings_v1';
const STORAGE_WORKOUTS_KEY = 'wt_workouts_v1';
const MQL_DARK = window.matchMedia('(prefers-color-scheme: dark)');

// ==========================================================================
//  App State
// ==========================================================================

const App = {
	settings: JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY)) || { defaultUnit: 'kg', appearance: 'light' },
	workouts: JSON.parse(localStorage.getItem(STORAGE_WORKOUTS_KEY)) || [],
	editIndex: null, // Index of the workout being edited, or null
	workoutStarted: false,
	workoutSeconds: 0,
	workoutTimerId: null, // ID for the global workout timer
	activeRowIndex: null, // Index of the row (card) currently being timed
	rowTimers: [], // array of interval IDs (per row) or null
	charts: {
		difficulty: null,
		weight: null,
		duration: null,
		break: null
	},
	panelResizeObserver: null,
	// Callbacks for custom modal
	modal: {
		onConfirm: null,
		onCancel: null
	}
};

// ==========================================================================
//  Utilities
// ==========================================================================

/**
 * Formats seconds into a HH:MM:SS or MM:SS string.
 * @param {number} secs - The number of seconds.
 * @returns {string} The formatted time string.
 */
const fmtTime = secs => {
	const s = Math.max(0, parseInt(secs, 10) || 0);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
	const ss = (s % 60).toString().padStart(2, '0');
	return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};

/** Saves the App.settings object to localStorage. */
const saveSettings = () => localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(App.settings));

/** Saves the App.workouts array to localStorage. */
const saveWorkouts = () => localStorage.setItem(STORAGE_WORKOUTS_KEY, JSON.stringify(App.workouts));

/**
 * Escapes a string for safe HTML insertion.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
const escapeHtml = str => {
	if (str == null) return '';
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

// ==========================================================================
//  DOM Helpers
// ==========================================================================

/**
 * Shorthand for document.getElementById.
 * @param {string} id - The element ID.
 * @returns {HTMLElement} The DOM element.
 */
const $ = id => document.getElementById(id);

/**
 * Creates a DOM element with properties and children.
 * @param {string} tag - The HTML tag name.
 * @param {object} [props={}] - Properties to set on the element.
 * @param {...(HTMLElement|string|null)} children - Child nodes to append.
 * @returns {HTMLElement} The created element.
 */
const create = (tag, props = {}, ...children) => {
	const el = document.createElement(tag);
	Object.entries(props).forEach(([k, v]) => {
		if (k === 'class') el.className = v;
		else if (k === 'html') el.innerHTML = v;
		else if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
		else el[k] = v;
	});
	children.forEach(c => { 
		if (c == null) return; 
		if (typeof c === 'string') el.appendChild(document.createTextNode(c)); 
		else el.appendChild(c); 
	});
	return el;
};

// ==========================================================================
//  Custom Modal (replaces alert/confirm)
// ==========================================================================

/**
 * Shows a custom modal dialog.
 * @param {string} text - The message to display.
 * @param {function} [onConfirm] - Callback if the 'OK' button is pressed.
 * @param {function} [onCancel] - Callback if 'Cancel' is pressed. If provided, the 'Cancel' button is shown.
 */
function showModal(text, onConfirm, onCancel) {
	$('modalText').textContent = text;
	App.modal.onConfirm = onConfirm || null;
	App.modal.onCancel = onCancel || null;
	
	$('modalCancelBtn').style.display = onCancel ? 'inline-block' : 'none';
	$('modalOverlay').style.display = 'flex';
}

/** Hides the custom modal. */
function hideModal() {
	$('modalOverlay').style.display = 'none';
	App.modal.onConfirm = null;
	App.modal.onCancel = null;
}

// ==========================================================================
//  Appearance (Theme)
// ==========================================================================

/** Applies the correct 'light', 'dark', or 'system' theme to the body. */
function applyAppearance() {
	let newAppearance = App.settings.appearance;
	if (newAppearance === 'system') {
		newAppearance = MQL_DARK.matches ? 'dark' : 'light';
	}
	document.body.classList.toggle('dark', newAppearance === 'dark');
}

// ==========================================================================
//  Workout Row (Card) Construction
// ==========================================================================

/**
 * Finds or creates the time display span in a card's action rail.
 * @param {HTMLElement} card - The workout card element.
 * @returns {HTMLElement} The time display span element.
 */
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
		rail.appendChild(timeCell);
	}
	return rail.querySelector('.time-display');
}

/**
 * Creates and appends a "Done" button (checkmark) to a card's action rail.
 * @param {HTMLElement} card - The workout card element.
 * @returns {HTMLElement} The created button element.
 */
function createDoneButton(card) {
	let rail = card.querySelector('.card-action-rail');
	if (!rail) {
		rail = create('div', { class: 'card-action-rail' });
		card.prepend(rail);
	}
	
	// Remove existing button if any
	let oldBtn = rail.querySelector('.row-done-btn');
	if (oldBtn) oldBtn.remove();
	
	// Use checkmark icon
	const btn = create('button', { 
		type: 'button', 
		class: 'row-done-btn',
		title: 'Mark done',
		html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
	});
	btn.addEventListener('click', () => completeRow(card));
	rail.appendChild(btn);
	return btn;
}

/**
 * Wires up event listeners for inputs within a card (slider, dropset checkbox, etc.).
 * @param {HTMLElement} card - The workout card element.
 */
function wireRowControls(card) {
	const slider = card.querySelector('.difficulty-slider');
	const sliderVal = card.querySelector('.difficulty-value');
	if (slider && sliderVal) {
		slider.addEventListener('input', () => { sliderVal.textContent = slider.value; });
	}

	const dropsetCb = card.querySelector('.dropset-checkbox');
	if (dropsetCb) {
		dropsetCb.addEventListener('change', e => toggleDropSet(e.target));
	}

	const repsInput = card.querySelector('.reps-field input[type="number"]');
	if (repsInput) {
		repsInput.addEventListener('input', () => updateDropSetInputs(repsInput));
	}
}

/**
 * Adds a new exercise card to the planning list.
 * @param {object} [ex={}] - An optional exercise object to pre-fill the card.
 */
function addExercise(ex = {}) {
	const container = $('workoutListContainer');
	const card = create('div', { class: 'workout-card exercise-card' });

	// Create the rail and content wrapper
	const rail = create('div', { class: 'card-action-rail' });
	const contentWrapper = create('div', { class: 'card-content' });
	card.appendChild(rail);
	card.appendChild(contentWrapper);

	// Get values or set defaults
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
				<label class="dropset-label"><input type="checkbox" class="dropset-checkbox"${dropset ? ' checked' : ''}> Enable Dropset</label>
				<div class="dropset-inputs" style="display:${dropset ? '' : 'none'}"></div>
			</div>

			<div class="card-field diff-field">
				<label>Difficulty (RPE 1-10)</label>
				<div class="difficulty-control">
					<input type="range" min="1" max="10" value="${difficulty}" class="difficulty-slider">
					<span class="difficulty-value">${difficulty}</span>
				</div>
			</div>
			
		</div>
	`;
	contentWrapper.innerHTML = html;

	// Add remove button to the rail
	const removeBtn = create('button', { 
		type: 'button', 
		class: 'row-remove-btn', 
		title: 'Remove row',
		html: '<svg><use href="#icon-trash"></use></svg>' 
	});
	removeBtn.addEventListener('click', () => card.remove());
	rail.appendChild(removeBtn);

	// Add duplicate button to the rail
	const dupBtn = create('button', { 
		type: 'button', 
		class: 'row-dup-btn', 
		title: 'Duplicate',
		html: '<svg><use href="#icon-duplicate"></use></svg>' 
	});
	dupBtn.addEventListener('click', () => {
		// Read current card values and call addExercise to append a copy
		const nameVal = card.querySelector('.exercise-name-input')?.value || '';
		const repsVal = parseInt(card.querySelector('.reps-field input')?.value || 0, 10) || 0;
		const isDropset = !!card.querySelector('.dropset-checkbox')?.checked;
		const weightsVal = isDropset
			? Array.from(card.querySelectorAll('.dropset-inputs input')).map(i => i.value || 0)
			: [card.querySelector('.single-weight')?.value || 0];
		const unitVal = card.querySelector('.unit-select')?.value || App.settings.defaultUnit;
		const diffVal = parseInt(card.querySelector('.difficulty-slider')?.value || 0, 10) || 0;

		addExercise({ type: 'exercise', name: nameVal, reps: repsVal, weights: weightsVal, unit: unitVal, dropset: isDropset, difficulty: diffVal });
	});
	rail.appendChild(dupBtn);

	// If workout is active, add timer and done button
	if (App.workoutStarted) {
		ensureTimeCell(card);
		createDoneButton(card);
		rail.classList.add('workout-active');
	}
	
	wireRowControls(card);

	// Restore dropset values if provided
	if (dropset && Array.isArray(ex.weights) && ex.weights.length) {
		const cb = card.querySelector('.dropset-checkbox');
		if (cb) toggleDropSet(cb, ex.weights);
	}

	// Restore time if provided (e.g., from history)
	if (ex.time != null) {
		ensureTimeCell(card);
	}
	
	container.appendChild(card);
}

/**
 * Adds a new break card to the planning list.
 * @param {object} [br={}] - An optional break object to pre-fill the card.
 */
function addBreak(br = {}) {
	const container = $('workoutListContainer');
	const card = create('div', { class: 'workout-card break-card' });

	// Create the rail and content wrapper
	const rail = create('div', { class: 'card-action-rail' });
	const contentWrapper = create('div', { class: 'card-content' });
	card.appendChild(rail);
	card.appendChild(contentWrapper);

	const duration = parseInt(br.duration || br.plannedDuration || 60, 10) || 60;
	
	// Store timer-related data directly on the DOM node
	card.dataset.plannedDuration = duration;
	card._timeLeft = duration;
	card._elapsed = br.time != null ? parseInt(br.time, 10) || 0 : 0;
	card._countdown = null; // Stores the interval ID for the countdown

	let html = `
		<div class="card-body break-body">
			Break: <input type="number" min="1" value="${duration}"> sec
		</div>
	`;
	contentWrapper.innerHTML = html;
	
	// Add remove button
	const remBtn = create('button', { 
		type: 'button', 
		class: 'row-remove-btn', 
		title: 'Remove break',
		html: '<svg><use href="#icon-trash"></use></svg>'
	});
	remBtn.addEventListener('click', () => card.remove());
	rail.appendChild(remBtn);

	// If workout is active, add timer and done button
	if (App.workoutStarted) {
		ensureTimeCell(card);
		createDoneButton(card);
		rail.classList.add('workout-active');
	}
	
	// Restore time display if pre-filled
	if (br.time != null) {
		const timeDisplay = ensureTimeCell(card);
		timeDisplay.dataset.seconds = card._elapsed;
		timeDisplay.textContent = fmtTime(card._elapsed);
	}
	
	container.appendChild(card);
}

// ==========================================================================
//  Dropset Helpers
// ==========================================================================

/**
 * Toggles the visibility of dropset weight inputs based on the checkbox.
 * @param {HTMLInputElement} checkbox - The "Enable Dropset" checkbox.
 * @param {Array<number>} [restoreValues=[]] - Optional array of weights to pre-fill.
 */
function toggleDropSet(checkbox, restoreValues = []) {
	const card = checkbox.closest('.workout-card');
	if (!card) return;
	
	const dropsetContainer = card.querySelector('.dropset-inputs');
	const singleWeight = card.querySelector('.single-weight');
	const repsInput = card.querySelector('.reps-field input[type="number"]');
	if (!dropsetContainer || !singleWeight || !repsInput) return;

	dropsetContainer.innerHTML = '';

	if (checkbox.checked) {
		dropsetContainer.style.display = 'grid';
		singleWeight.style.display = 'none';
		const count = Math.max(1, parseInt(repsInput.value || 1, 10));
		for (let i = 0; i < count; i++) {
			const val = (restoreValues[i] != null) ? restoreValues[i] : (i === 0 && singleWeight.value ? singleWeight.value : 0);
			const w = create('input', { type: 'number', min: '0', value: val });
			dropsetContainer.appendChild(w);
		}
	} else {
		dropsetContainer.style.display = 'none';
		singleWeight.style.display = '';
		if (restoreValues.length) {
			singleWeight.value = restoreValues[0];
		}
	}
}

/**
 * Updates the number of dropset inputs to match the reps input.
 * @param {HTMLInputElement} repsInput - The reps input field.
 */
function updateDropSetInputs(repsInput) {
	const card = repsInput.closest('.workout-card');
	if (!card) return;
	
	const dropsetCb = card.querySelector('.dropset-checkbox');
	if (!dropsetCb || !dropsetCb.checked) return;
	
	const container = card.querySelector('.dropset-inputs');
	if (!container) return;

	const currentInputs = Array.from(container.querySelectorAll('input'));
	const newCount = Math.max(1, parseInt(repsInput.value || 1, 10));

	if (currentInputs.length < newCount) {
		// Add new inputs
		const lastVal = currentInputs.length ? currentInputs[currentInputs.length - 1].value : 0;
		for (let i = currentInputs.length; i < newCount; i++) {
			const w = create('input', { type: 'number', min: '0', value: lastVal || 0 });
			container.appendChild(w);
		}
	} else if (currentInputs.length > newCount) {
		// Remove extra inputs
		for (let i = currentInputs.length - 1; i >= newCount; i--) {
			container.removeChild(currentInputs[i]);
		}
	}
}

// ==========================================================================
//  Row Timers (Stopwatch)
// ==========================================================================

/**
 * Starts a stopwatch timer for a specific row (card).
 * @param {number} index - The index of the card in the list.
 */
function startRowTimer(index) {
	const cards = Array.from($('workoutListContainer').children);
	if (index < 0 || index >= cards.length) return;
	
	// Stop other active timer
	if (App.activeRowIndex !== null && App.activeRowIndex !== index) {
		stopRowTimer(App.activeRowIndex);
	}

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

/**
 * Stops the stopwatch timer for a specific row.
 * @param {number} index - The index of the card in the list.
 */
function stopRowTimer(index) {
	if (App.rowTimers[index]) {
		clearInterval(App.rowTimers[index]);
		App.rowTimers[index] = null;
	}
	if (App.activeRowIndex === index) {
		App.activeRowIndex = null;
	}
}

// ==========================================================================
//  Global Workout Timer
// ==========================================================================

/** Starts the global workout timer. */
function startWorkoutTimer() {
	const display = $('workoutTotalTimer');
	// App.workoutSeconds = 0; // --- REMOVED --- This allows resuming
	if (App.workoutTimerId) clearInterval(App.workoutTimerId);
	
	App.workoutTimerId = setInterval(() => {
		App.workoutSeconds++;
		display.textContent = 'Total Time: ' + fmtTime(App.workoutSeconds);
	}, 1000);
}

/** Stops the global workout timer. */
function stopWorkoutTimer() {
	if (App.workoutTimerId) {
		clearInterval(App.workoutTimerId);
		App.workoutTimerId = null;
	}
}

// ==========================================================================
//  Break Countdown Timer
// ==========================================================================

/**
 * Starts a countdown timer for a break card.
 * @param {HTMLElement} breakCard - The break card element.
 */
function startBreakCountdown(breakCard) {
	const cell = breakCard.querySelector('.break-body');
	if (!cell) return;

	const planned = parseInt(breakCard.dataset.plannedDuration || 0, 10) || 60;
	breakCard.dataset.plannedDuration = planned;

	// Initialize runtime trackers if missing
	if (breakCard._timeLeft == null) breakCard._timeLeft = planned;
	if (breakCard._elapsed == null) breakCard._elapsed = 0;
	if (breakCard._countdown) {
		return; // Already running
	}

	ensureTimeCell(breakCard); // Ensure there's a time-display

	// Clean the cell and build countdown UI
	cell.innerHTML = '';
	const display = create('span', { class: 'break-countdown' });
	cell.appendChild(display);

	// Create control buttons
	const btnAdd = create('button', { type: 'button', class: 'small', textContent: '+10s' });
	const btnSub = create('button', { type: 'button', class: 'small', textContent: '-10s' });
	const btnReset = create('button', { type: 'button', class: 'small', textContent: 'Reset' });
	const btnSkip = create('button', { type: 'button', class: 'small', textContent: 'Skip' });
	
	[btnAdd, btnSub, btnReset, btnSkip].forEach(b => cell.appendChild(b));

	/** Updates the countdown display and handles completion. */
	const updateDisplay = () => {
		const left = breakCard._timeLeft;
		
		if (left <= 0) {
			// Break is done
			display.textContent = 'Break complete!';
			breakCard.classList.remove('break-warning');
			breakCard.classList.add('break-done');

			// Hide "Done" button on auto-complete
			const doneBtn = breakCard.querySelector('.row-done-btn');
			if (doneBtn) {
				doneBtn.style.display = 'none';
			}

			if (breakCard._countdown) {
				clearInterval(breakCard._countdown);
				breakCard._countdown = null;
			}

			// Record actual elapsed seconds to the main time display
			const timeDisplay = breakCard.querySelector('.time-display');
			if (timeDisplay) {
				timeDisplay.dataset.seconds = parseInt(breakCard._elapsed || 0, 10) || 0;
				timeDisplay.textContent = fmtTime(parseInt(breakCard._elapsed || 0, 10) || 0);
			}

			// --- Auto-advance to the next row ---
			const cards = Array.from($('workoutListContainer').children);
			const idx = cards.indexOf(breakCard);
			stopRowTimer(idx);
			
			if (idx + 1 < cards.length) {
				const next = cards[idx + 1];
				startRowTimer(idx + 1);
				// If next card is also a break, start its countdown
				if (next.classList.contains('break-card')) {
					const inp = next.querySelector('.break-body input[type="number"]');
					if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
					next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
					next._elapsed = 0;
					startBreakCountdown(next);
				}
			}
			// --- End auto-advance ---

		} else {
			// Break is in progress
			display.textContent = 'Break: ' + left + 's';
			breakCard.classList.toggle('break-warning', left <= 10);
		}
	};

	/** Restarts the interval if it's not already running. */
	const restartCountdown = () => {
		if (breakCard._timeLeft > 0 && !breakCard._countdown) {
			breakCard._countdown = setInterval(() => {
				breakCard._timeLeft = Math.max(0, breakCard._timeLeft - 1);
				breakCard._elapsed = (parseInt(breakCard._elapsed, 10) || 0) + 1;
				updateDisplay();
			}, 1000);
		}
	};

	// Wire up countdown controls
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

	// Initial render & start
	updateDisplay();
	restartCountdown();
}

// ==========================================================================
//  Workout Flow (Start, End, Complete Row)
// ==========================================================================

/**
 * Handles manually completing a row (exercise or break).
 * @param {HTMLElement} card - The card to complete.
 */
function completeRow(card) {
	const container = $('workoutListContainer');
	const cards = Array.from(container.children);
	const idx = cards.indexOf(card);
	if (idx < 0) return;

	if (card.classList.contains('break-card')) {
		// If it's a break, stop its countdown
		if (card._countdown) {
			clearInterval(card._countdown);
			card._countdown = null;
		}
		card.classList.remove('break-warning');
		card.classList.add('break-done');

		// Ensure the time display records proper elapsed seconds
		const td = card.querySelector('.time-display');
		if (td) {
			td.dataset.seconds = parseInt(card._elapsed || 0, 10) || 0;
			td.textContent = fmtTime(parseInt(card._elapsed || 0, 10) || 0);
		}
	} else {
		// It's an exercise card
		card.classList.add('exercise-done');
	}

	// Hide the "Done" button
	const doneBtn = card.querySelector('.row-done-btn');
	if (doneBtn) {
		doneBtn.style.display = 'none';
	}

	stopRowTimer(idx); // Stop this row's stopwatch

	// --- Auto-advance to the next row ---
	if (idx + 1 < cards.length) {
		const next = cards[idx + 1];
		if(App.workoutStarted){
			startRowTimer(idx + 1); // Start next row's stopwatch
			
			// If next card is a break, start its countdown
			if (next.classList.contains('break-card')) {
				const inp = next.querySelector('.break-body input[type="number"]');
				if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
				next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
				next._elapsed = 0;
				startBreakCountdown(next);
			}
		}
		else{
			App.activeRowIndex = idx + 1;
		}
	} else {
		// This was the last row, end the workout
		pauseWorkout(); // <-- PAUSE instead of hard stop
		
		const btn = $('startWorkoutBtn');
		btn.textContent = 'Start'; // Reset button to 'Start'
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		// document.body.classList.remove('show-workout'); // Don't remove this, user might want to save
	}
}

/** Pauses the global timer and all active row/break timers. */
function pauseWorkout() {
	// Stop all row timers (pauses them)
	App.rowTimers.forEach((id, i) => {
		if (id) {
			clearInterval(id);
			App.rowTimers[i] = null;
		}
	});
	// By NOT calling stopRowTimer(), App.activeRowIndex is preserved.
	
	App.workoutStarted = false; // Set state to "not running"
	stopWorkoutTimer(); // Pauses global timer

	// Find any active break countdowns and "pause" them
	const cards = Array.from($('workoutListContainer').children);
	cards.forEach(card => {
		if (card.classList.contains('break-card') && card._countdown && !card.classList.contains('break-done')) {
			clearInterval(card._countdown);
			card._countdown = 'paused'; // Use a string flag to indicate it's pausable
		}
	});
}

/**
 * Toggles the workout state (Start, Pause, Resume).
 */
function startWorkout() {
	const btn = $('startWorkoutBtn');
	const container = $('workoutListContainer');
	const cards = Array.from(container.children);

	if (btn.dataset.active === 'true') {
		// --- PAUSING WORKOUT ---
		// MODAL REMOVED
		pauseWorkout();
		btn.textContent = 'Resume'; // Change text to "Resume"
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		// document.body.classList.remove('show-workout'); // Keep UI active
		return;
	}

	// --- STARTING / RESUMING WORKOUT ---
	if (!cards.length) {
		showModal('Add at least one exercise first.');
		return;
	}

	// Check if it's a fresh start or a resume
	const isFreshStart = !App.workoutStarted && App.workoutSeconds === 0;

	if (isFreshStart) {
		// --- FRESH START ---
		document.body.classList.add('show-workout');
		// Add "Done" buttons and timers to all cards
		cards.forEach(card => {
			ensureTimeCell(card); // Ensure time cell exists FIRST
			createDoneButton(card);
			const rail = card.querySelector('.card-action-rail');
			if (rail) rail.classList.add('workout-active');
		});

		// Start the first card
		startRowTimer(0);
		const first = cards[0];
		if (first && first.classList.contains('break-card')) {
			const inp = first.querySelector('.break-body input[type="number"]');
			if (inp) first.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
			first._timeLeft = parseInt(first.dataset.plannedDuration || 0, 10) || 0;
			first._elapsed = 0;
			startBreakCountdown(first);
		}
		
		$('workoutTotalTimer').style.display = 'block';
		$('workoutTotalTimer').textContent = 'Total Time: 00:00';
		App.workoutSeconds = 0; // <-- Explicitly reset here
	
	} else {
		// --- RESUMING ---
		// Resume the active row timer
		if (App.activeRowIndex !== null) {
			startRowTimer(App.activeRowIndex);
		}
		// Resume any active break countdowns
		cards.forEach(card => {
			if (card.classList.contains('break-card') && card._countdown === 'paused') {
				card._countdown = null; // Clear the 'paused' flag
				startBreakCountdown(card); // This function will pick up where it left off
			}
		});
	}

	// This runs for both Fresh Start and Resume
	btn.textContent = 'End';
	btn.dataset.active = 'true';
	btn.classList.add('end');
	App.workoutStarted = true;
	startWorkoutTimer();
}

/**
 * Cleans up the UI and state when a workout ends.
 */
function endWorkout() {
	// Stop all row timers
	App.rowTimers.forEach((id, i) => {
		if (id) stopRowTimer(i);
	});
	App.activeRowIndex = null;
	App.workoutStarted = false;
	stopWorkoutTimer();

	// Clear break countdowns and reset their UI
	const cards = Array.from($('workoutListContainer').children);
	cards.forEach(card => {
		// Only reset the UI for breaks that were *in progress*
		if (card.classList.contains('break-card') && card._countdown && !card.classList.contains('break-done')) {
			clearInterval(card._countdown);
			card._countdown = null;
			const cell = card.querySelector('.break-body');
			const duration = card.dataset.plannedDuration || 60;
			if (cell) {
				cell.innerHTML = `Break: <input type="number" min="1" value="${duration}"> sec`;
			}
		}

		// Remove "Done" button and active rail state
		const doneBtn = card.querySelector('.row-done-btn');
		if (doneBtn) doneBtn.remove();
		const rail = card.querySelector('.card-action-rail');
		if (rail) rail.classList.remove('workout-active');
	});
}

// ==========================================================================
//  Save / Edit / Delete / Cancel
// ==========================================================================

/**
 * Saves the current workout plan (or edited workout) to history.
 */
function saveWorkout() {
	// End workout to freeze timers if active
	if (App.workoutStarted) {
		endWorkout();
	}

	const container = $('workoutListContainer');
	const cards = Array.from(container.children);
	if (!cards.length) { 
		showModal('Add at least one exercise!'); 
		return; 
	}

	// Read data from all cards
	const exercises = cards.map(card => {
		const td = card.querySelector('.time-display');
		const secs = parseInt(td?.dataset.seconds || 0, 10) || 0;

		if (card.classList.contains('break-card')) {
			// Save break data
			const planned = parseInt(card.dataset.plannedDuration || 0, 10) || (parseInt(card.querySelector('.break-body input')?.value || 0, 10) || 0);
			return { type: 'break', duration: planned, time: secs };
		} else {
			// Save exercise data
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

	// Compute total time
	let totalTime = App.workoutSeconds > 0 
		? App.workoutSeconds 
		: exercises.reduce((s, ex) => s + (parseInt(ex.time || 0, 10) || 0), 0);

	if (App.editIndex != null) {
		// Update existing workout
		App.workouts[App.editIndex].exercises = exercises;
		App.workouts[App.editIndex].date = new Date().toLocaleString();
		App.workouts[App.editIndex].totalTime = totalTime;
		App.editIndex = null;
		$('cancelEditBtn').style.display = 'none';
	} else {
		// Add new workout
		App.workouts.push({ date: new Date().toLocaleString(), exercises, totalTime });
	}

	saveWorkouts();
	renderHistory();
	updateExerciseSelector();
	renderProgress(); // Update charts

	// Reset planning area
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

/**
 * Loads a workout from history into the planning area for editing.
 * @param {number} index - The index of the workout in App.workouts.
 */
function editWorkout(index) {
	const container = $('workoutListContainer');
	container.innerHTML = ''; // Clear planning area
	
	// If a workout is active, end it
	if (App.workoutStarted) {
		endWorkout();
		const btn = $('startWorkoutBtn');
		btn.textContent = 'Start';
		btn.dataset.active = 'false';
		btn.classList.remove('end');
		document.body.classList.remove('show-workout');
	}

	const w = App.workouts[index];
	if (!w) return;
	
	// Re-create cards from history data
	(w.exercises || []).forEach(ex => {
		if (ex.type === 'break') addBreak(ex);
		else addExercise(ex);
	});
	
	App.editIndex = index;
	$('cancelEditBtn').style.display = 'inline-block';
	$('workoutTotalTimer').style.display = 'block';
	$('workoutTotalTimer').textContent = 'Total Time: ' + fmtTime(w.totalTime || 0);

	// Restore time displays and break data
	const cards = Array.from($('workoutListContainer').children);
	cards.forEach((card, i) => {
		const original = (w.exercises || [])[i];
		if (!original) return;
		
		const td = ensureTimeCell(card).querySelector('.time-display');
		if (td) {
			td.dataset.seconds = parseInt(original.time || 0, 10) || 0;
			td.textContent = fmtTime(parseInt(original.time || 0, 10) || 0);
		}

		if (card.classList.contains('break-card')) {
			card.dataset.plannedDuration = parseInt(original.duration || 0, 10) || 0;
			card._timeLeft = parseInt(original.duration || 0, 10) || 0;
			card._elapsed = parseInt(original.time || 0, 10) || 0;
		}
	});
}

/**
 * Deletes a workout from history.
 * @param {number} index - The index of the workout to delete.
 */
function deleteWorkout(index) {
	showModal('Are you sure you want to delete this workout?', 
		() => {
			// OK button pressed
			App.workouts.splice(index, 1);
			saveWorkouts();
			renderHistory();
			updateExerciseSelector();
			renderProgress();
		}, 
		() => {
			// Cancel button pressed
		}
	);
}

/** Cancels the editing state and clears the planning area. */
function cancelEdit() {
	App.editIndex = null;
	$('cancelEditBtn').style.display = 'none';
	$('workoutListContainer').innerHTML = '';
	$('workoutTotalTimer').style.display = 'none';
	App.workoutStarted = false;
	App.workoutSeconds = 0;
}

// ==========================================================================
//  History & UI Rendering
// ==========================================================================

/** Renders the list of past workouts in the History tab. */
function renderHistory() {
	const historyDiv = $('history');
	historyDiv.innerHTML = '';

	// Show newest first
	App.workouts.slice().reverse().forEach((workout, i) => {
		const actualIndex = App.workouts.length - 1 - i;
		const div = create('div', { class: 'history-entry' });
		
		const strong = create('strong', {}, workout.date);
		const span = create('span', {}, ' Total Time: ' + fmtTime(workout.totalTime || 0));

		// Edit button
		const editBtn = create('button', { class: 'edit-btn', textContent: 'Edit' });
		editBtn.addEventListener('click', () => {
			editWorkout(actualIndex);
			// Switch to planning tab
			document.querySelector('.tab-btn[data-target="main-panel"]').click();
		});

		// Delete button
		const delBtn = create('button', { class: 'delete-btn', textContent: 'Delete' });
		delBtn.addEventListener('click', () => deleteWorkout(actualIndex));

		// Use-as-template button
		const templateBtn = create('button', { class: 'edit-btn', textContent: 'Use as template' });
		templateBtn.addEventListener('click', () => {
			(workout.exercises || []).forEach(ex => {
				if (ex.type === 'break') addBreak(ex);
				else addExercise(ex);
			});
			// Switch to Planning tab
			document.querySelector('.tab-btn[data-target="main-panel"]').click();
		});

		// Container for exercise cards
		const exContainer = create('div', { class: 'history-exercise-list' });

		(workout.exercises || []).forEach(ex => {
			const card = create('div', { class: 'history-card' });
			
			const timeHtml = `
				<div class="hist-time">
					<strong>${fmtTime(ex.time || 0)}</strong>
					<span>Time</span>
				</div>`;
				
			if (ex.type === 'break') {
				card.classList.add('break-card');
				card.innerHTML = `
					${timeHtml}
					<div class="hist-details" style="text-align:center; font-style:italic;">
						Break: ${ex.duration || 0} sec
					</div>
				`;
			} else {
				card.classList.add('exercise-card');
				const repsDisplay = ex.reps || 0;
				const weightsDisplay = ex.dropset 
					? (Array.isArray(ex.weights) ? ex.weights.join(' → ') : ex.weights) 
					: (Array.isArray(ex.weights) ? ex.weights[0] : ex.weights);
				const unit = ex.unit || App.settings.defaultUnit;
				const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
				
				const statsItems = [];
				statsItems.push(`<span><strong>Reps:</strong> ${escapeHtml(String(repsDisplay))}</span>`);
		
				const allWeightsZero = !ex.weights || !Array.isArray(ex.weights) || ex.weights.every(w => (parseFloat(w) || 0) === 0);
		
				if (!allWeightsZero) {
					statsItems.push(`<span><strong>Weight:</strong> ${escapeHtml(String(weightsDisplay || '0'))} ${escapeHtml(unit)}</span>`);
				}
		
				statsItems.push(`<span><strong>Diff:</strong> ${escapeHtml(String(difficultyDisplay))}/10</span>`);
				
				card.innerHTML = `
					${timeHtml}
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
		div.appendChild(templateBtn);
		div.appendChild(delBtn);
		div.appendChild(exContainer); // Add card container
		historyDiv.appendChild(div);
	});
}

/** Updates the exercise name dropdown in the Progress tab. */
function updateExerciseSelector() {
	const select = $('exerciseSelect');
	if (!select) return;
	
	const names = new Set();
	App.workouts.forEach(w => {
		(w.exercises || []).forEach(ex => {
			if (ex.type === 'exercise' && ex.name && ex.name.trim()) {
				names.add(ex.name.trim());
			}
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

// ==========================================================================
//  Progress Charting (Chart.js)
// ==========================================================================

/**
 * Gets theme-appropriate colors for chart rendering.
 * @returns {object} An object with {grid, tick, legend} color strings.
 */
function chartColors() {
	let appearance = App.settings.appearance;
	if (appearance === 'system') {
		appearance = MQL_DARK.matches ? 'dark' : 'light';
	}
	return appearance === 'dark' 
		? { grid: '#334155', tick: '#cbd5e1', legend: '#e5e7eb' } 
		: { grid: '#ddd', tick: '#333', legend: '#111' };
}

/**
 * Processes workout history into data arrays for charting.
 * @param {string} selected - The selected exercise name, or '__all'.
 * @returns {object} An object with {labels, difficultyData, weightData, ...} arrays.
 */
function buildProgressData(selected) {
	let labels = [], difficultyData = [], weightData = [], durationData = [], breakData = [];

	if (selected === '__all') {
		// Data for "All exercises"
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
		// Data for a specific exercise
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
			
			let afters = []; // Breaks *after* this exercise
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

/**
 * Creates a new chart or updates an existing one.
 * @param {string} chartId - The canvas element ID.
 * @param {string} type - The key for App.charts (e.g., 'difficulty').
 * @param {Array<string>} labels - The X-axis labels.
 * @param {Array<number>} data - The Y-axis data points.
 * @param {string} datasetLabel - The label for the dataset.
 */
function createOrUpdateChart(chartId, type, labels, data, datasetLabel) {
	const canvas = $(chartId);
	if (!canvas) return;
	
	// Don't try to render a chart on a hidden canvas
	if (canvas.offsetParent === null) {
		return;
	}
	
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
			responsive: true, 
			maintainAspectRatio: true,
			scales: { 
				x: { display: false, grid: { drawTicks: false, drawBorder: false } }, 
				y: { grid: { color: colors.grid }, ticks: { color: colors.tick } } 
			},
			plugins: { 
				legend: { labels: { color: colors.legend } }, 
				tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } } 
			}
		}
	};
	
	// Apply specific colors/options
	if (type === 'weight') { 
		cfg.data.datasets[0].borderColor = 'rgb(34,197,94)'; 
		cfg.data.datasets[0].backgroundColor = 'rgba(34,197,94,0.1)'; 
	} else if (type === 'duration') { 
		cfg.data.datasets[0].borderColor = 'rgb(255,165,0)'; 
		cfg.data.datasets[0].backgroundColor = 'rgba(255,165,0,0.1)'; 
	} else if (type === 'break') { 
		cfg.data.datasets[0].borderColor = 'rgb(255,44,44)'; 
		cfg.data.datasets[0].backgroundColor = 'rgba(255,44,44,0.1)'; 
	} else { // difficulty
		cfg.options.scales.y.suggestedMin = 0; 
		cfg.options.scales.y.suggestedMax = 10; 
	}

	// Update existing chart or create new one
	if (App.charts[type]) {
		App.charts[type].config.type = cfg.type;
		App.charts[type].config.data = cfg.data;
		App.charts[type].options = cfg.options;
		App.charts[type].update();
	} else {
		App.charts[type] = new Chart(canvas.getContext('2d'), cfg);
	}
}

/** Destroys all Chart.js instances. */
function destroyCharts() {
	Object.keys(App.charts).forEach(key => {
		if (App.charts[key]) {
			App.charts[key].destroy();
			App.charts[key] = null;
		}
	});
}

/** Renders all progress charts. */
function renderProgress() {
	// Destroy existing charts to prevent rendering issues
	destroyCharts();
	
	// Re-create charts
	updateExerciseSelector();
	const selected = $('exerciseSelect')?.value || '__all';
	const d = buildProgressData(selected);

	createOrUpdateChart(
		'difficultyChart', 'difficulty', d.labels, d.difficultyData,
		selected === '__all' ? 'Avg Difficulty (all exercises)' : `Avg Difficulty — ${selected}`
	);
	createOrUpdateChart(
		'weightChart', 'weight', d.labels, d.weightData,
		selected === '__all' ? `Total Load (Volume) (${App.settings.defaultUnit})` : `Total Load — ${selected} (${App.settings.defaultUnit})`
	);
	createOrUpdateChart(
		'durationChart', 'duration', d.labels, d.durationData,
		selected === '__all' ? 'Workout Duration (sec)' : `Duration — ${selected} (sec)`
	);
	createOrUpdateChart(
		'breakChart', 'break', d.labels, d.breakData,
		selected === '__all' ? 'Total Break Time (sec)' : `Avg Break After — ${selected} (sec)`
	);
}

/** Attaches a ResizeObserver to charts to handle resizing. */
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

// ==========================================================================
//  CSV Export / Import
// ==========================================================================

function exportWorkoutsToCSV() {
    if (!App.workouts.length) {
        showModal('No history to export.');
        return null;
    }

    // Each row = one exercise/break from one workout
    const header = [
        'WorkoutIndex', 'Date', 'TotalTime',
        'Type', 'Name', 'Reps', 'Weights', 'Unit', 
        'Difficulty', 'Dropset', 'Duration', 'Time'
    ];

    const rows = [];

    App.workouts.forEach((w, wi) => {
        (w.exercises || []).forEach(ex => {
            rows.push([
                wi,
                `"${w.date}"`,
                w.totalTime ?? '',
                ex.type || '',
                `"${ex.name || ''}"`,
                ex.reps ?? '',
                `"${(Array.isArray(ex.weights) ? ex.weights.join('|') : (ex.weights ?? ''))}"`,
                ex.unit || '',
                ex.difficulty ?? '',
                ex.dropset ? '1' : '0',
                ex.duration ?? '',
                ex.time ?? ''
            ]);
        });
    });

    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    return csv; // Just return the CSV string
}

// Helper function for downloading CSV locally
function downloadCSV(csv) {
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'workout_history.csv';
    link.click();
    URL.revokeObjectURL(link.href);
}

function importWorkoutsFromCSV(file) {
    if (!file) {
        showModal('No file provided.');
        return;
    }

    const reader = new FileReader();
    reader.onload = e => {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length <= 1) {
            showModal('No valid CSV data found.');
            return;
        }

        const [headerLine, ...rows] = lines;
        // Simple header detection
        const headers = headerLine.split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
        
        // Find column indices
        const idx = {
            wi: headers.indexOf('workoutindex'),
            date: headers.indexOf('date'),
            totalTime: headers.indexOf('totaltime'),
            type: headers.indexOf('type'),
            name: headers.indexOf('name'),
            reps: headers.indexOf('reps'),
            weights: headers.indexOf('weights'),
            unit: headers.indexOf('unit'),
            diff: headers.indexOf('difficulty'),
            dropset: headers.indexOf('dropset'),
            duration: headers.indexOf('duration'),
            time: headers.indexOf('time')
        };

        // Check for essential columns
        if (idx.wi < 0 || idx.type < 0) {
            showModal('Invalid CSV format. Missing WorkoutIndex or Type columns.');
            return;
        }
        
        // Rebuild workouts as stored in localStorage
        const workouts = [];
        rows.forEach(line => {
            // Regex to split CSV, handling quotes
            const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < headers.length) return;

            const workoutIndex = parseInt(cols[idx.wi], 10) || 0;
            
            if (!workouts[workoutIndex]) {
                workouts[workoutIndex] = { 
                    date: cols[idx.date], 
                    exercises: [], 
                    totalTime: parseInt(cols[idx.totalTime]) || 0 
                };
            }

            workouts[workoutIndex].exercises.push({
                type: cols[idx.type],
                name: cols[idx.name],
                reps: parseInt(cols[idx.reps]) || 0,
                weights: cols[idx.weights] ? cols[idx.weights].split('|').map(w => parseFloat(w) || 0) : [],
                unit: cols[idx.unit],
                difficulty: parseInt(cols[idx.diff]) || 0,
                dropset: cols[idx.dropset] === '1',
                duration: parseInt(cols[idx.duration]) || 0,
                time: parseInt(cols[idx.time]) || 0
            });
        });

        const imported = workouts.filter(Boolean); // Remove empty/sparse entries

        showModal(
            `Found ${imported.length} workouts. Importing will overwrite your current history. Continue?`,
            () => {
                App.workouts = imported;
                saveWorkouts();
                renderHistory();
                updateExerciseSelector();
                renderProgress();
                showModal('Import complete.');
            },
            () => {
                // User cancelled
            }
        );
    };
    reader.readAsText(file);
}

// ==========================================================================
//  Initialization & Event Listeners
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
	
	// --- 1. Apply theme immediately ---
	applyAppearance();

	// --- 2. Wire up Settings Panel ---
	$('defaultUnit').value = App.settings.defaultUnit || 'kg';
	$('appearance').value = App.settings.appearance || 'light';
	
	$('defaultUnit').addEventListener('change', () => {
		App.settings.defaultUnit = $('defaultUnit').value;
		saveSettings();
		renderProgress(); // Redraw charts with new unit label
	});
	
	$('appearance').addEventListener('change', () => {
		App.settings.appearance = $('appearance').value;
		saveSettings();
		applyAppearance();
		renderProgress(); // Re-render charts for new theme
	});

	// Listen for system theme changes
	MQL_DARK.addEventListener('change', () => {
		if (App.settings.appearance === 'system') {
			applyAppearance();
			renderProgress();
		}
	});
	
	// Import/Export buttons
	$('exportCSVBtn').addEventListener('click', exportWorkoutsToCSV);
	$('importCSVBtn').addEventListener('click', () => $('importFileInput').click());
	$('importFileInput').addEventListener('change', e => {
		const file = e.target.files[0];
		if (file) importWorkoutsFromCSV(file);
		e.target.value = ''; // Reset input
	});

	// --- 3. Wire up Main Planning Buttons ---
	$('addExerciseBtn').addEventListener('click', () => addExercise());
	$('addBreakBtn').addEventListener('click', () => addBreak());
	$('saveWorkoutBtn').addEventListener('click', saveWorkout);
	$('startWorkoutBtn').addEventListener('click', startWorkout);
	$('cancelEditBtn').addEventListener('click', cancelEdit);

	// --- 4. Wire up Progress Filters ---
	$('exerciseSelect').addEventListener('change', renderProgress);
	
	// --- 5. Wire up Modal Buttons ---
	$('modalConfirmBtn').addEventListener('click', () => {
		if (App.modal.onConfirm) {
			App.modal.onConfirm();
		}
		hideModal();
	});
	
	$('modalCancelBtn').addEventListener('click', () => {
		if (App.modal.onCancel) {
			App.modal.onCancel();
		}
		hideModal();
	});
	
	// Click on overlay to close modal (like a cancel)
	$('modalOverlay').addEventListener('click', (e) => {
		if (e.target === $('modalOverlay')) {
			if (App.modal.onCancel) {
				App.modal.onCancel();
			}
			hideModal();
		}
	});

	// --- 6. Wire up Tab Navigation ---
	const tabButtons = document.querySelectorAll('.tab-btn');
	const panels = document.querySelectorAll('.main-panel, .progress-panel, .history-panel, .settings-panel');
	const mainContainer = document.querySelector('.container'); // Get container once
	
	tabButtons.forEach(btn => {
		btn.addEventListener('click', () => {
			// Update button active state
			tabButtons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');

			// Update panel visibility
			panels.forEach(p => p.classList.remove('active'));
			const targetPanel = document.querySelector('.' + btn.dataset.target);
			if (targetPanel) {
				targetPanel.classList.add('active');
			}
			
			// === MODIFIED LOGIC HERE ===
			// Show/Hide top controls AND adjust padding
			const topControls = document.querySelector('.top-controls-container');
			
			if (btn.dataset.target === 'main-panel') {
				if (topControls) topControls.style.display = 'block';
				if (mainContainer) mainContainer.style.paddingTop = '140px';
			} else {
				if (topControls) topControls.style.display = 'none';
				if (mainContainer) mainContainer.style.paddingTop = '20px'; // Set smaller padding
			}
			// === END OF MODIFIED LOGIC ===
			
			// Re-render progress charts *only* when its tab is selected
			if (btn.dataset.target === 'progress-panel') {
				// Use setTimeout to ensure the panel is visible *before* rendering
				setTimeout(() => {
					renderProgress();
				}, 50); // 50ms delay is usually enough for DOM to update
			}
		});
	});

	// --- 7. Initial Render ---
	renderHistory();
	updateExerciseSelector();
	// Note: Progress charts are now rendered only when the tab is clicked.
	
	// --- 8. Attach Observers ---
	attachPanelResizeObserver();
});

// ==========================================================================
//  Google Drive API
// ==========================================================================

/* exported gapiLoaded */
/* exported gisLoaded */
/* exported handleAuthClick */
/* exported handleSignoutClick */
// TODO(developer): Set to client ID from the Developer Console
const CLIENT_ID = '669473273169-c1ag0g07cbo023vn5q8jovr86fehm96u.apps.googleusercontent.com';
// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;
let gapiInited = false;
let gisInited = false;
document.getElementById('authorize_button').style.visibility = 'hidden';
document.getElementById('signout_button').style.visibility = 'hidden';
/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
	gapi.load('client', initializeGapiClient);
}
/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
	await gapi.client.init({
		discoveryDocs: [DISCOVERY_DOC],
	});
	gapiInited = true;
	maybeEnableButtons();
}
/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
	tokenClient = google.accounts.oauth2.initTokenClient({
		client_id: CLIENT_ID,
		scope: SCOPES,
		callback: '', // defined later
	});
	gisInited = true;
	maybeEnableButtons();
}
/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableButtons() {
	if (gapiInited && gisInited) {
		document.getElementById('authorize_button').style.visibility = 'visible';
	}
}
/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
	tokenClient.callback = async (resp) => {
		if (resp.error !== undefined) {
			throw (resp);
		}
		document.getElementById('signout_button').style.visibility = 'visible';
		document.getElementById('authorize_button').innerText = 'Refresh';
	};
	if (gapi.client.getToken() === null) {
		// Prompt the user to select a Google Account and ask for consent to share their data
		// when establishing a new session.
		tokenClient.requestAccessToken({prompt: 'consent'});
	} else {
		// Skip display of account chooser and consent dialog for an existing session.
		tokenClient.requestAccessToken({prompt: ''});
	}
}
/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
	const token = gapi.client.getToken();
	if (token !== null) {
		google.accounts.oauth2.revoke(token.access_token);
		gapi.client.setToken('');
		document.getElementById('content').innerText = '';
		document.getElementById('authorize_button').innerText = 'Authorize';
		document.getElementById('signout_button').style.visibility = 'hidden';
	}
}

// ==========================================================================
//  Google Drive Backup Helpers
// ==========================================================================

// Folder name where backups will be stored
const BACKUP_FOLDER_NAME = "WorkoutTrackerBackups";

/**
 * Ensures the backup folder exists, creates it if missing.
 * Returns a Promise that resolves with the folder ID.
 */
async function ensureBackupFolder() {
	const response = await gapi.client.drive.files.list({
		q: `mimeType='application/vnd.google-apps.folder' and name='${BACKUP_FOLDER_NAME}' and trashed=false`,
		fields: "files(id, name)",
		spaces: "drive",
	});

	if (response.result.files && response.result.files.length > 0) {
		console.log("Backup folder found:", response.result.files[0].id);
			return response.result.files[0].id;
	}

	// Folder not found → create it
	const createResponse = await gapi.client.drive.files.create({
		resource: {
			name: BACKUP_FOLDER_NAME,
			mimeType: "application/vnd.google-apps.folder",
		},
		fields: "id",
	});

	console.log("Backup folder created:", createResponse.result.id);
	return createResponse.result.id;
}

/**
 * Uploads a CSV file into the backup folder.
 * @param {string} csvData - The CSV string to upload.
 * @param {string} fileName - The name of the file, e.g. 'backup_2025-11-09.csv'.
 */
async function uploadCSVToDrive(csvData, fileName) {
	const folderId = await ensureBackupFolder();

	const fileMetadata = {
		name: fileName,
		parents: [folderId],
	};

	const file = new Blob([csvData], { type: "text/csv" });
	const form = new FormData();
	form.append(
		"metadata",
		new Blob([JSON.stringify(fileMetadata)], { type: "application/json" })
	);
	form.append("file", file);

	const accessToken = gapi.auth.getToken().access_token;
	const response = await fetch(
		"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
		{
			method: "POST",
			headers: new Headers({ Authorization: "Bearer " + accessToken }),
			body: form,
		}
	);

	const result = await response.json();
	console.log("File uploaded:", result);
	return result.id;
}

/**
 * Called when user clicks "Backup to Drive".
 * Grabs your exported CSV and uploads it.
 */
async function handleBackups() {
	try {
		const csv = exportWorkoutsToCSV(); // <-- Uses your existing CSV export logic
		const fileName = `workout_backup_${new Date()
		.toISOString()
		.split("T")[0]}.csv`;

		await uploadCSVToDrive(csv, fileName);
		showModal("Backup successful! Check your Google Drive folder.");
	} catch (err) {
		console.error("Backup failed:", err);
		showModal("Backup failed. Check console for details.");
	}
}