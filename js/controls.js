/**
 * Controls system supporting Keyboard, Mobile Touch/Virtual Joystick, and Gamepad API.
 */
export class Controls {
  constructor() {
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false
    };

    this.enabled = false;
    this.keys = {};

    // Touch control state
    this.touchData = {
      active: false,
      identifier: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0
    };
    this.touchSprintActive = false;
    this.touchJumpActive = false;

    // Pause tracking
    this.pauseTriggered = false;
    this.pauseHandled = false;

    this.init();
  }

  /**
   * Initializes event listeners for keyboard, touch, and window events.
   */
  init() {
    // Keyboard events
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Prevent page scrolling on gameplay keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        if (this.enabled) {
          e.preventDefault();
        }
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.pauseTriggered = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.pauseHandled = false;
      }
    });

    // Clear stuck keys when window loses focus
    window.addEventListener('blur', () => {
      this.keys = {};
      this.touchData.active = false;
      this.touchSprintActive = false;
      this.touchJumpActive = false;
    });

    // Mobile Touch Events
    // Left half: Virtual Joystick (drag up = forward, drag down = backward, drag left/right = steer)
    // Right half: Buttons (top right = sprint, bottom right = jump)
    window.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const width = window.innerWidth;
      const height = window.innerHeight;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.clientX < width * 0.5) {
          // Left half: activate steering joystick
          if (!this.touchData.active) {
            this.touchData.active = true;
            this.touchData.identifier = touch.identifier;
            this.touchData.startX = touch.clientX;
            this.touchData.startY = touch.clientY;
            this.touchData.currentX = touch.clientX;
            this.touchData.currentY = touch.clientY;
          }
        } else {
          // Right half: action buttons
          if (touch.clientY < height * 0.5) {
            this.touchSprintActive = true;
          } else {
            this.touchJumpActive = true;
          }
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (this.touchData.active && touch.identifier === this.touchData.identifier) {
          this.touchData.currentX = touch.clientX;
          this.touchData.currentY = touch.clientY;
          e.preventDefault();
        }
      }
    }, { passive: false });

    const handleTouchEnd = (e) => {
      const height = window.innerHeight;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (this.touchData.active && touch.identifier === this.touchData.identifier) {
          this.touchData.active = false;
          this.touchData.identifier = null;
        } else if (touch.clientX >= window.innerWidth * 0.5) {
          if (touch.clientY < height * 0.5) {
            this.touchSprintActive = false;
          } else {
            this.touchJumpActive = false;
          }
        }
      }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  }

  /**
   * Polls input devices and updates the input state.
   */
  update() {
    if (!this.enabled) {
      this.input.forward = false;
      this.input.backward = false;
      this.input.left = false;
      this.input.right = false;
      this.input.sprint = false;
      this.input.jump = false;
      return;
    }

    // 1. Keyboard Inputs
    const kForward = Boolean(this.keys['KeyW'] || this.keys['ArrowUp']);
    const kBackward = Boolean(this.keys['KeyS'] || this.keys['ArrowDown']);
    const kLeft = Boolean(this.keys['KeyA'] || this.keys['ArrowLeft']);
    const kRight = Boolean(this.keys['KeyD'] || this.keys['ArrowRight']);
    const kSprint = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    const kJump = Boolean(this.keys['Space']);

    // 2. Touch Inputs (Virtual Joystick)
    let tForward = false;
    let tBackward = false;
    let tLeft = false;
    let tRight = false;

    if (this.touchData.active) {
      const dx = this.touchData.currentX - this.touchData.startX;
      const dy = this.touchData.currentY - this.touchData.startY;
      const deadzone = 16;

      if (dy < -deadzone) tForward = true;
      if (dy > deadzone) tBackward = true;
      if (dx < -deadzone) tLeft = true;
      if (dx > deadzone) tRight = true;
    }

    // 3. Gamepad API
    let gForward = false;
    let gBackward = false;
    let gLeft = false;
    let gRight = false;
    let gSprint = false;
    let gJump = false;

    const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    if (gamepads) {
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;

        // Left Analog Stick
        const stickX = gp.axes[0] || 0;
        const stickY = gp.axes[1] || 0;
        const stickDeadzone = 0.22;

        if (stickY < -stickDeadzone) gForward = true;
        if (stickY > stickDeadzone) gBackward = true;
        if (stickX < -stickDeadzone) gLeft = true;
        if (stickX > stickDeadzone) gRight = true;

        // D-pad (Buttons 12: Up, 13: Down, 14: Left, 15: Right)
        if (gp.buttons[12] && gp.buttons[12].pressed) gForward = true;
        if (gp.buttons[13] && gp.buttons[13].pressed) gBackward = true;
        if (gp.buttons[14] && gp.buttons[14].pressed) gLeft = true;
        if (gp.buttons[15] && gp.buttons[15].pressed) gRight = true;

        // Triggers and Action Buttons
        // Button 0: A (Jump), Button 1: B (Sprint), Button 2: X (Sprint), Button 7: RT (Sprint/Accelerate)
        if (gp.buttons[0] && gp.buttons[0].pressed) gJump = true;
        if (gp.buttons[1] && gp.buttons[1].pressed) gSprint = true;
        if (gp.buttons[2] && gp.buttons[2].pressed) gSprint = true;
        if (gp.buttons[5] && gp.buttons[5].pressed) gSprint = true; // Right Bumper
        if (gp.buttons[7] && gp.buttons[7].pressed) gForward = true; // Right Trigger Accelerate

        // Start button for pause (Button 9)
        if (gp.buttons[9] && gp.buttons[9].pressed) {
          this.pauseTriggered = true;
        }

        break; // Use the first active gamepad
      }
    }

    // Combine all input sources
    this.input.forward = kForward || tForward || gForward;
    this.input.backward = kBackward || tBackward || gBackward;
    this.input.left = kLeft || tLeft || gLeft;
    this.input.right = kRight || tRight || gRight;
    this.input.sprint = kSprint || this.touchSprintActive || gSprint;
    this.input.jump = kJump || this.touchJumpActive || gJump;
  }

  /**
   * Enables controls processing.
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disables controls and zeroes all inputs.
   */
  disable() {
    this.enabled = false;
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false
    };
    this.touchData.active = false;
    this.touchSprintActive = false;
    this.touchJumpActive = false;
  }

  /**
   * Checks whether the pause key/button is currently pressed.
   * @returns {boolean}
   */
  isPausePressed() {
    return Boolean(this.keys['Escape'] || this.keys['KeyP'] || this.pauseTriggered);
  }

  /**
   * Consumes a single pause event (returns true once per press).
   * @returns {boolean}
   */
  consumePause() {
    if (this.pauseTriggered && !this.pauseHandled) {
      this.pauseHandled = true;
      this.pauseTriggered = false;
      return true;
    }
    return false;
  }
}
