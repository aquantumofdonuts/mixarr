/**
 * Mixarr Landing Page JavaScript
 * Handles: Navigation, Carousel, Tabs, Copy, Lightbox
 */

document.addEventListener('DOMContentLoaded', () => {
  // ========================================
  // Mobile Navigation Toggle
  // ========================================
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      navToggle.classList.toggle('active');
    });

    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        navToggle.classList.remove('active');
      });
    });
  }

  // ========================================
  // Hero Carousel
  // ========================================
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.slider-dots .dot');
  let slideIndex = 0;
  let slideInterval;

  function showSlide(index) {
    if (slides.length === 0) return;
    
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    
    slideIndex = (index + slides.length) % slides.length;
    slides[slideIndex].classList.add('active');
    if (dots[slideIndex]) {
      dots[slideIndex].classList.add('active');
    }
  }

  function nextSlide() {
    showSlide(slideIndex + 1);
  }

  function startCarousel() {
    slideInterval = setInterval(nextSlide, 5000);
  }

  function stopCarousel() {
    clearInterval(slideInterval);
  }

  // Initialize carousel
  if (slides.length > 0) {
    showSlide(0);
    startCarousel();

    // Dot navigation
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        stopCarousel();
        showSlide(index);
        startCarousel();
      });
    });

    // Pause on hover
    const slider = document.querySelector('.hero-slider');
    if (slider) {
      slider.addEventListener('mouseenter', stopCarousel);
      slider.addEventListener('mouseleave', startCarousel);
    }
  }

  // ========================================
  // Install Tabs
  // ========================================
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Remove active from all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active to clicked
      btn.classList.add('active');
      const targetTab = document.getElementById(`tab-${tabId}`);
      if (targetTab) {
        targetTab.classList.add('active');
      }
    });
  });

  // ========================================
  // Copy to Clipboard
  // ========================================
  const copyBtns = document.querySelectorAll('.copy-btn');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.target;
      const codeElement = document.querySelector(`#${targetId} code`);
      
      if (!codeElement) return;
      
      const code = codeElement.textContent;
      
      try {
        await navigator.clipboard.writeText(code);
        
        // Visual feedback
        btn.classList.add('copied');
        const span = btn.querySelector('span');
        const originalText = span.textContent;
        span.textContent = 'Copied!';
        
        setTimeout(() => {
          btn.classList.remove('copied');
          span.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });

  // ========================================
  // Gallery Lightbox
  // ========================================
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox?.querySelector('.lightbox-img');
  const lightboxCaption = lightbox?.querySelector('.lightbox-caption');
  const galleryItems = document.querySelectorAll('.gallery-item');
  let currentIndex = 0;

  function openLightbox(index) {
    if (!lightbox || !galleryItems[index]) return;
    
    currentIndex = index;
    const item = galleryItems[index];
    const img = item.querySelector('img');
    
    if (lightboxImg && img) {
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
    }
    
    if (lightboxCaption) {
      lightboxCaption.textContent = item.dataset.caption || '';
    }
    
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  function prevImage() {
    currentIndex = (currentIndex - 1 + galleryItems.length) % galleryItems.length;
    openLightbox(currentIndex);
  }

  function nextImage() {
    currentIndex = (currentIndex + 1) % galleryItems.length;
    openLightbox(currentIndex);
  }

  // Gallery item clicks
  galleryItems.forEach((item, index) => {
    item.addEventListener('click', () => openLightbox(index));
  });

  // Lightbox controls
  if (lightbox) {
    const closeBtn = lightbox.querySelector('.lightbox-close');
    const prevBtn = lightbox.querySelector('.lightbox-prev');
    const nextBtn = lightbox.querySelector('.lightbox-next');

    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    if (prevBtn) prevBtn.addEventListener('click', prevImage);
    if (nextBtn) nextBtn.addEventListener('click', nextImage);

    // Close on background click
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('active')) return;
      
      switch (e.key) {
        case 'Escape':
          closeLightbox();
          break;
        case 'ArrowLeft':
          prevImage();
          break;
        case 'ArrowRight':
          nextImage();
          break;
      }
    });
  }

  // ========================================
  // Smooth Scroll for Anchor Links
  // ========================================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = document.querySelector('.navbar')?.offsetHeight || 70;
        const targetPosition = target.offsetTop - navHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // ========================================
  // Navbar Background on Scroll
  // ========================================
  const navbar = document.querySelector('.navbar');
  
  if (navbar) {
    const updateNavbar = () => {
      if (window.scrollY > 50) {
        navbar.style.background = 'rgba(26, 26, 46, 0.98)';
      } else {
        navbar.style.background = 'rgba(26, 26, 46, 0.95)';
      }
    };

    window.addEventListener('scroll', updateNavbar, { passive: true });
    updateNavbar();
  }
});
