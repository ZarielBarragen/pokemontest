/*
 * cleanup.js — lightweight lifecycle/teardown manager (no deps)
 *
 * This module provides a simple way to group together resources such as
 * requestAnimationFrame loops, intervals/timeouts, event listeners, and
 * custom unsubscribe functions into a scoped object. When the scope is
 * disposed, all registered resources are automatically cancelled. This
 * helps prevent memory leaks and ghost listeners when transitioning
 * between different screens or phases in an application.
 *
 * Usage:
 *   import './cleanup.js';
 *   const scope = Cleanup.createScope('lobby');
 *   const stopLoop = scope.startLoop('gameLoop', (t) => { ... });
 *   const cancelTimer = scope.setInterval(fn, 1000);
 *   scope.addUnsub(someUnsubscribeFunction);
 *   // Later, when leaving the lobby
 *   scope.dispose();
 */
(function(global) {
  // Internal helper to ensure passed values are functions
  function assertFn(name, fn) {
    if (typeof fn !== 'function') throw new Error(name + ' must be a function');
  }

  class Scope {
    constructor(name) {
      this.name = name || 'scope';
      // Set of cleanup callbacks for this scope
      this._items = new Set();
      // Map of running animation loops keyed by name
      this._running = new Map();
      this._disposed = false;
    }

    /**
     * Register a cleanup callback with this scope. The callback will be
     * invoked when the scope is disposed. Returns a function that can be
     * called to remove the cleanup callback early.
     */
    _track(cleaner) {
      if (this._disposed) {
        try { cleaner(); } catch (e) {}
        return () => {};
      }
      this._items.add(cleaner);
      return () => {
        if (this._items.has(cleaner)) {
          try { cleaner(); } catch (e) {}
          this._items.delete(cleaner);
        }
      };
    }

    /**
     * Register a custom unsubscribe function. Accepts undefined/null safely.
     */
    addUnsub(unsub) {
      if (!unsub) return () => {};
      assertFn('unsub', unsub);
      return this._track(unsub);
    }

    /**
     * Request a one-shot animation frame. Returns a cancel function.
     */
    requestFrame(fn) {
      assertFn('requestFrame(fn)', fn);
      const id = requestAnimationFrame((t) => fn(t));
      return this._track(() => cancelAnimationFrame(id));
    }

    /**
     * Start a named animation loop. The function will be called on every
     * animation frame until the returned stop function is called or the
     * scope is disposed.
     */
    startLoop(name, fn) {
      if (typeof name === 'function') { fn = name; name = `loop#${Math.random().toString(36).slice(2)}`; }
      assertFn('startLoop(fn)', fn);
      if (this._running.has(name)) return this._running.get(name);

      let active = true;
      let rafId = 0;
      const tick = (t) => {
        if (!active) return;
        try { fn(t); } catch (e) { console.error(`[Cleanup] loop error (${name})`, e); }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);

      const stop = () => {
        if (!active) return;
        active = false;
        cancelAnimationFrame(rafId);
        this._running.delete(name);
      };

      const unreg = this._track(stop);
      const wrappedStop = () => { stop(); unreg(); };
      this._running.set(name, wrappedStop);
      return wrappedStop;
    }

    /**
     * Register a setInterval timer. Returns a cancel function. When
     * called, the timer is cleared.
     */
    setInterval(fn, ms) {
      assertFn('setInterval(fn)', fn);
      const id = setInterval(fn, ms);
      return this._track(() => clearInterval(id));
    }

    /**
     * Register a setTimeout timer. Returns a cancel function. When
     * called, the timeout is cleared.
     */
    setTimeout(fn, ms) {
      assertFn('setTimeout(fn)', fn);
      const id = setTimeout(fn, ms);
      return this._track(() => clearTimeout(id));
    }

    /**
     * Add an event listener to a target and register its removal with
     * this scope. Returns a cancel function that removes the listener.
     */
    addEvent(target, type, handler, options) {
      if (!target || !type || !handler) return () => {};
      target.addEventListener(type, handler, options);
      return this._track(() => target.removeEventListener(type, handler, options));
    }

    /**
     * Create an AbortController whose abort() is registered with this scope.
     * When the scope is disposed, the controller will be aborted.
     */
    makeAbortController() {
      const ac = new AbortController();
      this._track(() => ac.abort());
      return ac;
    }

    /**
     * Dispose the scope, calling all registered cleanup callbacks. After
     * disposal, no new callbacks will be accepted and any existing
     * callbacks invoked immediately upon registration.
     */
    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      const items = Array.from(this._items);
      this._items.clear();
      for (const clean of items) {
        try { clean(); } catch (e) {}
      }
      this._running.clear();
    }
  }

  const Cleanup = {
    // A global root scope that can be used for application-wide cleanup
    root: new Scope('root'),
    /**
     * Create a new scope. Give it a name for easier debugging.
     */
    createScope(name) { return new Scope(name); }
  };

  // Attach Cleanup to the global object so it can be used everywhere.
  global.Cleanup = Cleanup;

})(typeof window !== 'undefined' ? window : this);