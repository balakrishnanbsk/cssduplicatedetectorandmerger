import React from 'react';
import styles from './Component.module.css';

// This component has conflicts between:
// 1. Tailwind utilities (p-6, bg-white, text-lg)
// 2. CSS Module classes (styles.container, styles.button)
// 3. Global CSS (.container, .button from global.css)

export function TestComponent() {
  return (
    <div className={`${styles.container} p-6 bg-white max-w-4xl`}>
      <h1 className={`${styles.title} text-2xl font-bold text-center`}>
        CSS Conflict Radar Test
      </h1>

      <div className={`${styles.header} p-4 bg-gray-100 text-xl`}>
        Header Section
      </div>

      <div className={`${styles.card} p-8 rounded-lg border`}>
        <p className="text-base font-medium text-gray-700">
          This card has competing styles from global CSS, CSS Modules, and Tailwind.
        </p>

        <button className={`${styles.button} px-6 py-3 rounded-md font-semibold cursor-pointer`}>
          Click Me
        </button>
      </div>
    </div>
  );
}
