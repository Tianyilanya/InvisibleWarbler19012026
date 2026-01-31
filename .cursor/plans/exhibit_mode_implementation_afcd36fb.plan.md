---
name: Exhibit Mode Implementation
overview: Implement an \"Exhibit Mode\" that provides a cinematic documentary-style viewing experience with automatic bird following, UI hiding, and smooth camera movements.
todos:
  - id: add_state
    content: Add exhibitMode state management object
    status: completed
  - id: add_key_handler
    content: Add E key event handler for toggling exhibit mode
    status: completed
  - id: implement_toggle
    content: Implement enterExhibitMode and exitExhibitMode functions
    status: completed
  - id: implement_selection
    content: Implement target selection logic with 20-second interval
    status: completed
  - id: implement_camera
    content: Implement cinematic camera movement with orbit path
    status: completed
  - id: integrate_loop
    content: Integrate updateExhibitModeCamera into main animate loop
    status: completed
  - id: add_ui_functions
    content: Add UI hiding/showing functions
    status: completed
  - id: add_birth_notification
    content: Add bird birth notification to switch exhibit target
    status: completed
  - id: test_mode
    content: Test the complete exhibit mode functionality
    status: completed
---

# Exhibit Mode Implementation Plan

## Overview

Implement a new "Exhibit Mode" (activated by pressing E) that provides a cinematic documentary-style viewing experience with automatic bird following, UI hiding, and smooth camera movements.

## Implementation Steps

### 1. Add Exhibit Mode State Management

**File:** [src/index.js](src/index.js)

Add new state management object after the existing `observationMode` object (around line 77):

```javascript
// Exhibit模式状态
const exhibitMode = {
  active: false,
  targetBird: null,
  lastTargetSwitchTime: 0,
  targetSwitchInterval: 20000, // 20秒切换
  cameraOffset: new THREE.Vector3(5, 2, 5), // 初始偏移
  orbitAngle: 0,
  orbitSpeed: 0.1, // 弧度/秒
  lookAtOffset: new THREE.Vector3(0, 0, 0),
  entryAnimation: null
};
```

### 2. Add Keyboard Event Handler for E Key

**File:** [src/index.js](src/index.js)

Modify the existing event listener section (around line 193) to add E key handling:

```javascript
document.addEventListener('keydown', (event) => {
  // ... existing code ...
  
  // Exhibit Mode toggle
  if (event.key.toLowerCase() === 'e') {
    toggleExhibitMode();
  }
});
```

### 3. Implement Exhibit Mode Toggle Functions

**File:** [src/index.js](src/index.js)

Add after the existing `exitObservationMode` function:

```javascript
function toggleExhibitMode() {
  if (exhibitMode.active) {
    exitExhibitMode();
  } else {
    enterExhibitMode();
  }
}

function enterExhibitMode() {
  exhibitMode.active = true;
  exhibitMode.lastTargetSwitchTime = Date.now();
  exhibitMode.orbitAngle = 0;
  
  // 禁用OrbitControls
  if (controls) {
    controls.enabled = false;
  }
  
  // 隐藏UI元素
  hideExhibitModeUI();
  
  // 选择初始目标
  selectExhibitTarget();
  
  console.log('🎬 进入Exhibit模式');
  showToast('Exhibit模式 - 按E退出');
}

function exitExhibitMode() {
  exhibitMode.active = false;
  exhibitMode.targetBird = null;
  
  // 重新启用OrbitControls
  if (controls) {
    controls.enabled = true;
  }
  
  // 显示UI元素
  showExhibitModeUI();
  
  console.log('🎬 退出Exhibit模式');
  showToast('退出Exhibit模式');
}
```

### 4. Implement Target Selection Logic

**File:** [src/index.js](src/index.js)

Add function to select and switch exhibit targets:

```javascript
function selectExhibitTarget() {
  const activeBirds = flyingBirds.filter(b => b && b.alive && b.mesh);
  
  if (activeBirds.length === 0) {
    exhibitMode.targetBird = null;
    return;
  }
  
  // 如果当前有目标且还在活跃中，考虑是否切换
  if (exhibitMode.targetBird && exhibitMode.targetBird.alive) {
    const timeSinceSwitch = Date.now() - exhibitMode.lastTargetSwitchTime;
    
    // 20秒后才考虑切换
    if (timeSinceSwitch < exhibitMode.targetSwitchInterval) {
      return; // 保持当前目标
    }
    
    // 20%概率主动切换到其他鸟，增加变化
    if (Math.random() < 0.2) {
      switchToRandomBird(activeBirds);
    }
  } else {
    // 当前目标已死亡，选择新目标
    switchToRandomBird(activeBirds);
  }
}

function switchToRandomBird(activeBirds) {
  // 优先选择最新的鸟
  const sortedBirds = activeBirds.sort((a, b) => b.birthTime - a.birthTime);
  exhibitMode.targetBird = sortedBirds[0];
  exhibitMode.lastTargetSwitchTime = Date.now();
  exhibitMode.orbitAngle = 0; // 重置旋转角度
  console.log('🎬 Exhibit切换目标:', exhibitMode.targetBird?.userData?.seed);
}
```

### 5. Implement Cinematic Camera Movement

**File:** [src/index.js](src/index.js)

Add function to calculate and apply cinematic camera movement:

```javascript
function updateExhibitModeCamera(deltaTime) {
  if (!exhibitMode.active || !exhibitMode.targetBird) return;
  
  const bird = exhibitMode.targetBird;
  
  // 检查鸟类是否还活着
  if (!bird.alive || !bird.mesh) {
    selectExhibitTarget();
    return;
  }
  
  // 每20秒检查是否需要切换目标
  const timeSinceSwitch = Date.now() - exhibitMode.lastTargetSwitchTime;
  if (timeSinceSwitch > exhibitMode.targetSwitchInterval) {
    selectExhibitTarget();
  }
  
  // 计算电影感相机位置
  // 使用平滑的轨道运动 + 鸟类位置变化
  exhibitMode.orbitAngle += exhibitMode.orbitSpeed * deltaTime;
  
  const birdPos = bird.mesh.position.clone();
  
  // 相机在鸟类周围做缓慢的圆形轨道运动
  const orbitRadius = 6 + Math.sin(exhibitMode.orbitAngle * 0.5) * 2; // 4-8范围变化
  const cameraOffset = new THREE.Vector3(
    Math.cos(exhibitMode.orbitAngle) * orbitRadius,
    2 + Math.sin(exhibitMode.orbitAngle * 0.3) * 1, // 1-3高度变化
    Math.sin(exhibitMode.orbitAngle) * orbitRadius
  );
  
  const targetCameraPos = birdPos.clone().add(cameraOffset);
  
  // 平滑移动相机
  camera.position.lerp(targetCameraPos, 0.02);
  
  // 相机看向鸟类稍微偏前的位置（模拟导演视角）
  const lookAtOffset = new THREE.Vector3(
    Math.sin(exhibitMode.orbitAngle * 0.7) * 2,
    0,
    Math.cos(exhibitMode.orbitAngle * 0.7) * 2
  );
  const lookAtPos = birdPos.clone().add(lookAtOffset);
  camera.lookAt(lookAtPos);
}
```

### 6. Integrate with Main Animation Loop

**File:** [src/index.js](src/index.js)

Modify the main `animate` function (around line 5249):

```javascript
function animate() {
  requestAnimationFrame(animate);
  
  // 计算帧间隔（用于平滑动画）
  const deltaTime = 1 / 60; // 或使用clock.getDelta()
  
  // 生成新的飞行鸟类
  generateFlyingBirds();
  
  // 更新飞行鸟类的位置和动画
  updateFlyingBirds();
  
  // 更新Exhibit模式
  if (exhibitMode.active) {
    updateExhibitModeCamera(deltaTime);
  }
  
  // 更新观察模式（只在非Exhibit模式下）
  if (!exhibitMode.active) {
    updateObservationMode();
  }
  
  // 更新OrbitControls（只在非Exhibit和非观察模式下）
  if (controls && !observationMode.active && !exhibitMode.active) {
    controls.update();
  }
  
  render();
}
```

### 7. Add UI Hiding/Showing Functions

**File:** [src/index.js](src/index.js)

Add functions to hide/show UI elements:

```javascript
function hideExhibitModeUI() {
  // 隐藏胶卷UI
  if (filmRollElement) {
    filmRollElement.style.opacity = '0';
    filmRollElement.style.transition = 'opacity 0.5s';
  }
  
  // 隐藏其他UI元素
  const uiElements = document.querySelectorAll('[class*="ui"], #ui, .ui');
  uiElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.5s';
  });
}

function showExhibitModeUI() {
  // 显示胶卷UI
  if (filmRollElement) {
    filmRollElement.style.opacity = '1';
  }
  
  // 显示其他UI元素
  const uiElements = document.querySelectorAll('[class*="ui"], #ui, .ui');
  uiElements.forEach(el => {
    el.style.opacity = '1';
  });
}
```

### 8. Add Bird Birth Notification

**File:** [src/index.js](src/index.js)

Modify the bird generation function (around line 4575) to notify exhibit mode:

```javascript
flyingBirds.push(flyingBird);

// 通知Exhibit模式有新鸟生成
if (exhibitMode.active && flyingBird.isAlive) {
  exhibitMode.targetBird = flyingBird;
  exhibitMode.lastTargetSwitchTime = Date.now();
  exhibitMode.orbitAngle = 0;
  console.log('🎬 Exhibit发现新鸟，跟随切换');
}
```

## Key Differences from Existing observationMode

| Feature | observationMode | ExhibitMode (New) |

|---------|-----------------|-------------------|

| Activation | Click on bird | Press E key |

| Camera | Static offset follow | Cinematic orbit movement |

| Target Selection | Manual click | Automatic (new bird priority) |

| Target Switch | Only on death | Every 20 seconds + new bird + death |

| UI | Not hidden | Automatically hidden |

## Testing Checklist

- [ ] Press E to enter/exit Exhibit mode
- [ ] Camera controls disabled during Exhibit mode
- [ ] UI elements hidden when entering Exhibit mode
- [ ] Camera smoothly follows newly generated birds
- [ ] Camera switches target every 20 seconds
- [ ] Camera switches when current target dies
- [ ] Camera movement is smooth and cinematic
- [ ] UI elements restored when exiting Exhibit mode