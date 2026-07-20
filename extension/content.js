// UnMeet Content Script
// Injected into meeting pages to detect meeting state and inject rating UI

(function() {
  'use strict';

  let meetingActive = false;
  let ratingInjected = false;

  // ── Platform-specific meeting detection ──
  function detectMeetingState() {
    const url = window.location.href;

    // Google Meet
    if (url.includes('meet.google.com')) {
      // Meeting is active when the call controls are visible
      const callEndButton = document.querySelector('[data-tooltip="Leave call"], [aria-label*="Leave"], [aria-label*="leave"]');
      return !!callEndButton || !!document.querySelector('[data-call-state="active"]');
    }

    // Zoom Web
    if (url.includes('zoom.us')) {
      return !!document.querySelector('.leave-meeting-options, #leaveButton, .meeting-app');
    }

    // Microsoft Teams
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) {
      return !!document.querySelector('[data-tid="call-hangup-btn"], #hangup-button, [aria-label*="Hang up"]');
    }

    // Feishu
    if (url.includes('feishu.cn')) {
      return !!document.querySelector('[class*="hangup"], [class*="leave"], [class*="endCall"]');
    }

    // Generic: if URL matches, assume active
    return true;
  }

  // ── Rating injection ──
  function injectRatingUI() {
    if (ratingInjected) return;
    ratingInjected = true;

    // Create a small floating rating bar
    const bar = document.createElement('div');
    bar.id = 'unmeet-rating-bar';
    bar.innerHTML = `
      <style>
        #unmeet-rating-bar {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          background: #111318;
          border: 1px solid #1E2028;
          border-radius: 12px;
          padding: 12px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
          font-size: 13px;
          color: #B0B3BD;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          gap: 10px;
          opacity: 0;
          transform: translateY(10px);
          transition: all 0.3s ease;
        }
        #unmeet-rating-bar.visible {
          opacity: 1;
          transform: translateY(0);
        }
        #unmeet-rating-bar .label {
          white-space: nowrap;
          color: #5C5F6B;
        }
        #unmeet-rating-bar .stars {
          display: flex;
          gap: 4px;
        }
        #unmeet-rating-bar .star {
          cursor: pointer;
          font-size: 18px;
          color: #2A2D35;
          transition: color 0.15s;
          user-select: none;
        }
        #unmeet-rating-bar .star:hover,
        #unmeet-rating-bar .star.active {
          color: #F59E0B;
        }
        #unmeet-rating-bar .skip {
          cursor: pointer;
          color: #5C5F6B;
          margin-left: 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        #unmeet-rating-bar .skip:hover { color: #B0B3BD; }
      </style>
      <span class="label">Rate this meeting</span>
      <div class="stars">
        <span class="star" data-rating="1">★</span>
        <span class="star" data-rating="2">★</span>
        <span class="star" data-rating="3">★</span>
        <span class="star" data-rating="4">★</span>
        <span class="star" data-rating="5">★</span>
      </div>
      <span class="skip">Skip</span>
    `;
    document.body.appendChild(bar);

    let rated = false;
    // Star hover
    bar.querySelectorAll('.star').forEach(star => {
      star.addEventListener('mouseenter', () => {
        if (rated) return;
        const rating = parseInt(star.dataset.rating);
        bar.querySelectorAll('.star').forEach((s, i) => {
          s.classList.toggle('active', i < rating);
        });
      });
      star.addEventListener('click', () => {
        if (rated) return;
        rated = true;
        const rating = parseInt(star.dataset.rating);
        chrome.runtime.sendMessage({ action: 'rateMeeting', rating }, () => {
          bar.querySelector('.label').textContent = `Rated ${rating}/5`;
          bar.querySelector('.stars').style.display = 'none';
          bar.querySelector('.skip').textContent = 'Close';
          bar.querySelector('.skip').addEventListener('click', () => bar.remove());
        });
      });
    });

    // Skip
    bar.querySelector('.skip').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'endMeeting' }, () => bar.remove());
    });

    // Show with delay
    setTimeout(() => bar.classList.add('visible'), 500);

    // Auto-hide after 30s if not rated
    setTimeout(() => {
      if (!rated) bar.remove();
    }, 30000);
  }

  // ── Monitor ──
  function check() {
    const wasActive = meetingActive;
    meetingActive = detectMeetingState();

    if (meetingActive && !wasActive) {
      // Meeting just started
      chrome.runtime.sendMessage({ action: 'meetingDetected', url: window.location.href });
    }

    if (!meetingActive && wasActive) {
      // Meeting just ended — show rating UI
      injectRatingUI();
    }
  }

  // Periodic check
  setInterval(check, 5000);
  check();

  // Also detect page unload (meeting tab closed)
  window.addEventListener('beforeunload', () => {
    if (meetingActive) {
      chrome.runtime.sendMessage({ action: 'meetingEnded' });
    }
  });

  console.log('[UnMeet] Content script loaded');
})();
