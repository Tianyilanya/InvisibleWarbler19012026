import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from './loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from './loaders/HDRLoader.js';
import { RoomEnvironment } from './environments/RoomEnvironment.js';
import { createSteering } from './modules/steering.js';
import { PathGenerator } from './modules/pathUtils.js';
import { birdComponentLibrary } from './modules/birdComponentLibrary.js';
import { createFilmRollUI, updateFilmRollUI } from './components/FilmRollUI.js';

// 创建配置好的GLTFLoader（支持Draco和Meshopt压缩）
function createGLTFLoader() {
	const loader = new GLTFLoader();

	// 配置DRACO解码器（用于Draco几何压缩）
	const dracoLoader = new DRACOLoader();
	// DRACO解码器路径现在通过webpack自动解析
	loader.setDRACOLoader(dracoLoader);

	// 配置Meshopt解码器（用于Meshopt几何压缩）
	loader.setMeshoptDecoder(MeshoptDecoder);

	console.log('✅ GLTFLoader已配置DRACO和Meshopt解码器');
	return loader;
}

let camera, scene, renderer, controls;
let birdGroup; // 鸟类组合组
let forestGroup; // 树林组合组
let treePositions = []; // 树木位置数组
let flyingBirds = []; // 存储飞行中的鸟类
let lastBirdGenerationTime = 0; // 上次生成鸟类的时间
const BIRD_GENERATION_INTERVAL = 5000; // 5秒生成间隔
const MAX_FLYING_BIRDS = 5; // 最大飞行鸟类数量

// 鼠标选择相关变量
let selectionState = {
	isSelecting: false,
	startTime: 0,
	pointerStartPos: null,
	selectedObject: null,
	progressElement: null
};

// 长按所需时间（ms） - 与读条同步
const SELECTION_REQUIRED_TIME = 1800;

// 鸟类淡入淡出配置
const BIRD_FADE_IN_MS = 5000;
const BIRD_FADE_OUT_MS = 5000;
const BIRD_LIFETIME_BONUS_MS = 10000;

// 相机聚焦状态
const cameraFocusState = {
	active: false,
	animationId: null,
	startTime: 0,
	duration: 0,
	startPos: null,
	targetPos: null,
	startTarget: null,
	targetCenter: null,
	original: null
};

// 观察模式状态
const observationMode = {
	active: false,
	targetBird: null,
	followDistance: 8,
	followHeight: 3,
	smoothFactor: 0.02,
	rightMouseDown: false,
	lastRightMousePos: { x: 0, y: 0 }
};

// 双击检测
let lastClickTime = 0;
const DOUBLE_CLICK_DELAY = 300; // 300ms内的两次点击算双击

// 胶卷UI元素
let filmRollElement;

// 捕获的鸟类组合体（session-only）
let capturedBirds = [];
// 预览组装相关
let previewAssembly = null;
let previewComponents = []; // { partType, model }
const SLOT_ORDER = ['head','chest','belly','tail','leftWing','rightWing','leftFoot','rightFoot'];
let nextSlotIndex = 0;

// 智能布局系统 - 混合策略组件分组
let componentGroups = {
    head: [], chest: [], belly: [], tail: [],
    leftWing: [], rightWing: [], leftFoot: [], rightFoot: []
};

// 布局参数配置（与debugParams同步）
window.previewLayoutParams = window.debugParams;

// 全局调试参数（提前初始化）
window.debugParams = {
	maxSpeed: 200.0,
	maxForce: 3.5,
	arrivalRadius: 50.0,
	wanderStrength: 50.0,
	avoidRadius: 3.0,
	lookahead: 2.0,
	heightOffset: -11.0,  // 全局高度偏移
	// 预览布局参数
	distributedRadius: 0.15,
	spiralTurns: 1.5,
	spiralHeightStep: 0.08,
	spiralRadiusStep: 0.05,
	cascadeGravity: 0.15,
	cascadeSpread: 0.12,
	symmetricSpacing: 0.08
};

init();

async function init() {
	// Background music will be initialized after scene loading is complete

6	// Create loading overlay
	const loadingOverlay = document.createElement('div');
	loadingOverlay.id = 'loadingOverlay';
	loadingOverlay.style.cssText = `
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0,0,0,0.5);
		z-index: 9999;
		pointer-events: none;
	`;
	const loadingBox = document.createElement('div');
	loadingBox.style.cssText = `
		padding: 12px 18px;
		background: rgba(0,0,0,0.6);
		border-radius: 8px;
		color: white;
		font-family: Arial, sans-serif;
		font-size: 16px;
		text-align: center;
	`;
	const textSpan = document.createElement('span');
	textSpan.textContent = 'Loading models';
	const dotsSpan = document.createElement('span');
	dotsSpan.id = 'loadingDots';
	dotsSpan.textContent = '...';
	loadingBox.appendChild(textSpan);
	loadingBox.appendChild(dotsSpan);
	loadingOverlay.appendChild(loadingBox);
	document.body.appendChild(loadingOverlay);

	// Animated dots
	let dotCount = 0;
	const dotTimer = setInterval(() => {
		dotCount = (dotCount + 1) % 4; // 0..3
		dotsSpan.textContent = '.'.repeat(dotCount);
	}, 500);

	// Hide loading overlay function
	function hideLoadingOverlay() {
		clearInterval(dotTimer);
		if (loadingOverlay && loadingOverlay.parentNode) {
			loadingOverlay.parentNode.removeChild(loadingOverlay);
		}

		// Initialize background music after scene is ready
		const backgroundMusic = document.getElementById('backgroundMusic');
		if (backgroundMusic) {
			backgroundMusic.volume = 0.6; // Set volume to 60%

			// Try to play music now that scene is loaded
			const playPromise = backgroundMusic.play();
			if (playPromise !== undefined) {
				playPromise.catch(() => {
					console.log('Auto-play prevented, music will start on first user interaction');

					// Start music on first user interaction
					const startMusic = () => {
						backgroundMusic.play();
						document.removeEventListener('click', startMusic);
						document.removeEventListener('keydown', startMusic);
						document.removeEventListener('touchstart', startMusic);
					};

					document.addEventListener('click', startMusic);
					document.addEventListener('keydown', startMusic);
					document.addEventListener('touchstart', startMusic);
				});
			}
		}
	}

	// Safety timeout - hide after 45 seconds max
	const maxTimeout = setTimeout(() => {
		hideLoadingOverlay();
	}, 45000);

	const container = document.createElement('div');
	document.body.appendChild(container);

	// 创建相机
	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.25, 100);
	camera.position.set(-15, 8, 15); // 更高的位置，俯视整个森林

	// 创建场景
	scene = new THREE.Scene();

	// 创建鸟类组合组
	birdGroup = new THREE.Group();
	birdGroup.name = 'bird-assembly';

	// 创建树林组合组
	forestGroup = new THREE.Group();
	forestGroup.name = 'forest';

	// 生成随机树林
	generateForest();

	// 生成地面扭曲线条
	createTwistingJitterLine();

	// 初始化组件库
	await birdComponentLibrary.initialize();

	// 加载 HDR 环境照明 (royal_esplanade_1k.hdr 用于材质照明，但不用于背景)
	const hdrLoader = new HDRLoader().setPath('./hdr/');

	// 加载环境照明贴图
	hdrLoader.load('royal_esplanade_1k.hdr',
		async function (envTexture) {
			try {
				envTexture.mapping = THREE.EquirectangularReflectionMapping;
				scene.environment = envTexture; // 仅用于环境照明

				// 设置淡灰色背景（不使用HDR背景）
				const lightGray = 0xcccccc;
				scene.background = new THREE.Color(lightGray);

				render();

				// 加载并组合鸟类部件（使用新的组件库系统）
				await loadBirdComponentsNew();

				// Hide loading overlay after models are loaded
				hideLoadingOverlay();
				clearTimeout(maxTimeout);
			} catch (error) {
				console.error('加载模型失败:', error);
				textSpan.textContent = 'Loading failed. Please refresh.';
				dotsSpan.textContent = '';
				clearInterval(dotTimer);
				setTimeout(() => {
					hideLoadingOverlay();
				}, 3000);
			}
		},
		function (progress) {
			// 可以在这里显示加载进度，但暂时保持简单
		},
		function (error) {
			console.error('HDR加载失败:', error);
			textSpan.textContent = 'Loading failed. Please refresh.';
			dotsSpan.textContent = '';
			clearInterval(dotTimer);
			setTimeout(() => {
				hideLoadingOverlay();
			}, 3000);
		}
	);

	// 创建渲染器
	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
				container.appendChild(renderer.domElement);

				// 添加环境光照和雾效果
				addLightingAndFog();

				// 添加控制器
	controls = new OrbitControls(camera, renderer.domElement);
	controls.addEventListener('change', render);
	controls.minDistance = 5;
	controls.maxDistance = 50;
	controls.target.set(0, 5, 0); // 看向森林中央稍微高一点的位置
	controls.update();

	window.addEventListener('resize', onWindowResize);

	// 添加鼠标选择事件处理器
	setupMouseSelection();

	// 创建控制面板
	createControlPanel();

	// 添加键盘快捷键监听器
	window.addEventListener('keydown', (event) => {
		if (event.key === '1') {
			toggleControlPanel();
		}
		// Q键进入/退出观察模式
		if (event.key.toLowerCase() === 'q') {
			event.preventDefault();
			if (observationMode.active) {
				exitObservationMode();
			} else {
				enterObservationMode();
			}
		}
	});

	// 添加鼠标事件监听器（右键拖拽退出观察模式）
	window.addEventListener('mousedown', (event) => {
		if (event.button === 2) { // 右键
			observationMode.rightMouseDown = true;
			observationMode.lastRightMousePos = { x: event.clientX, y: event.clientY };
		}
	});

	window.addEventListener('mousemove', (event) => {
		if (observationMode.active && observationMode.rightMouseDown) {
			const deltaX = Math.abs(event.clientX - observationMode.lastRightMousePos.x);
			const deltaY = Math.abs(event.clientY - observationMode.lastRightMousePos.y);
			if (deltaX > 10 || deltaY > 10) { // 移动超过10像素
				exitObservationMode();
			}
		}
	});

	window.addEventListener('mouseup', (event) => {
		if (event.button === 2) { // 右键
			observationMode.rightMouseDown = false;
		}
	});

	// 阻止右键菜单
	window.addEventListener('contextmenu', (event) => {
		if (observationMode.active) {
			event.preventDefault();
		}
	});

	// 初始化胶卷UI：点击展示所有捕获鸟类的重组结果
	filmRollElement = createFilmRollUI(() => {
		displayCapturedAssemblies();
	});
	document.body.appendChild(filmRollElement);

	// 创建音量控制UI
	createVolumeControlUI();
}

	// 创建控制面板
function createControlPanel() {
	const panel = document.createElement('div');
	panel.id = 'controlPanel';
	panel.style.position = 'absolute';
	panel.style.top = '10px';
	panel.style.right = '10px';
	panel.style.background = 'rgba(0,0,0,0.8)';
	panel.style.color = 'white';
	panel.style.padding = '15px';
	panel.style.borderRadius = '8px';
	panel.style.fontFamily = 'monospace';
	panel.style.fontSize = '12px';
	panel.style.zIndex = '100';
	// 默认隐藏
	panel.style.display = 'none';

	panel.innerHTML = `
		<strong>Scene Control</strong><br><br>
		<label>
			<input type="radio" name="birdPosition" value="center" checked> Scene Center (Test)
		</label><br>
		<label>
			<input type="radio" name="birdPosition" value="tree"> On Branches
		</label><br><br>
		<button onclick="updateBirdPosition()">Apply</button><br><br>

		<strong>Debug Parameters</strong><br><br>
		<label>Max Speed: <span id="maxSpeedValue">200.0</span></label><br>
		<input type="range" id="maxSpeedSlider" min="0.1" max="500" step="1" value="200.0"><br><br>

		<label>Max Force: <span id="maxForceValue">3.5</span></label><br>
		<input type="range" id="maxForceSlider" min="0.1" max="20" step="0.1" value="3.5"><br><br>

		<label>Arrival Radius: <span id="arrivalRadiusValue">50.0</span></label><br>
		<input type="range" id="arrivalRadiusSlider" min="0.1" max="100" step="1" value="50.0"><br><br>

		<label>Wander Strength: <span id="wanderStrengthValue">50.0</span></label><br>
		<input type="range" id="wanderStrengthSlider" min="0.1" max="100" step="1" value="50.0"><br><br>

		<label>Avoid Radius: <span id="avoidRadiusValue">3.0</span></label><br>
		<input type="range" id="avoidRadiusSlider" min="1.0" max="20" step="0.5" value="3.0"><br><br>

		<label>Lookahead: <span id="lookaheadValue">2.0</span></label><br>
		<input type="range" id="lookaheadSlider" min="0.5" max="5.0" step="0.5" value="2.0"><br><br>

		<label>Height Offset: <span id="heightOffsetValue">-11.0</span></label><br>
		<input type="range" id="heightOffsetSlider" min="-20.0" max="20.0" step="0.5" value="-11.0"><br><br>

		<strong>Preview Layout Parameters</strong><br><br>
		<label>Distributed Radius: <span id="distributedRadiusValue">0.15</span></label><br>
		<input type="range" id="distributedRadiusSlider" min="0.05" max="0.5" step="0.01" value="0.15"><br><br>

		<label>Spiral Turns: <span id="spiralTurnsValue">1.5</span></label><br>
		<input type="range" id="spiralTurnsSlider" min="0.5" max="3.0" step="0.1" value="1.5"><br><br>

		<label>Spiral Height Step: <span id="spiralHeightStepValue">0.08</span></label><br>
		<input type="range" id="spiralHeightStepSlider" min="0.02" max="0.2" step="0.01" value="0.08"><br><br>

		<label>Spiral Radius Step: <span id="spiralRadiusStepValue">0.05</span></label><br>
		<input type="range" id="spiralRadiusStepSlider" min="0.01" max="0.1" step="0.005" value="0.05"><br><br>

		<label>Cascade Gravity: <span id="cascadeGravityValue">0.15</span></label><br>
		<input type="range" id="cascadeGravitySlider" min="0.05" max="0.3" step="0.01" value="0.15"><br><br>

		<label>Cascade Spread: <span id="cascadeSpreadValue">0.12</span></label><br>
		<input type="range" id="cascadeSpreadSlider" min="0.05" max="0.3" step="0.01" value="0.12"><br><br>

		<label>Symmetric Spacing: <span id="symmetricSpacingValue">0.08</span></label><br>
		<input type="range" id="symmetricSpacingSlider" min="0.02" max="0.2" step="0.01" value="0.08"><br><br>

		<div id="sceneStats">
			Loading...
		</div>
	`;

	// 添加滑块事件监听
	setTimeout(() => {
		const sliders = ['maxSpeed', 'maxForce', 'arrivalRadius', 'wanderStrength', 'avoidRadius', 'lookahead', 'heightOffset',
			'distributedRadius', 'spiralTurns', 'spiralHeightStep', 'spiralRadiusStep', 'cascadeGravity', 'cascadeSpread', 'symmetricSpacing'];
		sliders.forEach(param => {
			const slider = document.getElementById(param + 'Slider');
			const valueSpan = document.getElementById(param + 'Value');

			if (slider && valueSpan) {
				slider.addEventListener('input', (e) => {
					const value = parseFloat(e.target.value);
					window.debugParams[param] = value;

					// 根据参数类型设置不同的精度
					let precision = 2; // 默认2位小数
					if (param === 'maxForce') precision = 3;
					else if (['spiralTurns', 'distributedRadius', 'cascadeGravity', 'cascadeSpread', 'symmetricSpacing'].includes(param)) precision = 2;
					else if (['maxSpeed', 'arrivalRadius', 'wanderStrength', 'avoidRadius', 'lookahead', 'heightOffset', 'spiralHeightStep', 'spiralRadiusStep'].includes(param)) precision = 1;

					valueSpan.textContent = value.toFixed(precision);

					// 如果有预览组装，实时更新布局
					if (previewAssembly && componentGroups) {
						// 同步参数到previewLayoutParams
						window.previewLayoutParams[param] = value;
						// 重新应用布局
						applySmartLayout(previewAssembly);
					}
				});
			}
		});
	}, 100);

	document.body.appendChild(panel);

	// 切换控制面板显示/隐藏
	window.toggleControlPanel = function() {
		const panel = document.getElementById('controlPanel');
		if (panel) {
			const isHidden = panel.style.display === 'none';
			panel.style.display = isHidden ? 'block' : 'none';
			console.log('Control Panel:', isHidden ? 'Shown' : 'Hidden');
		}
	};

	// 将函数暴露到全局
	window.updateBirdPosition = function() {
		const selected = document.querySelector('input[name="birdPosition"]:checked').value;
		repositionBird(selected);
	};
}

// 更新场景统计信息
function updateSceneStats() {
	const statsDiv = document.getElementById('sceneStats');
	if (!statsDiv) return;

	const birdComponents = birdGroup.children.length;
	const trees = treePositions.length;
	const flyingBirdCount = flyingBirds.filter(bird => bird.isAlive).length;

	// 统计不同性格的鸟类
	const personalityCount = {};
	Object.values(BIRD_PERSONALITIES).forEach(personality => {
		personalityCount[personality] = 0;
	});

	flyingBirds.filter(bird => bird.isAlive).forEach(bird => {
		personalityCount[bird.personality]++;
	});

	let birdTriangles = 0;
	birdGroup.traverse((child) => {
		if (child.isMesh && child.geometry) {
			const geometry = child.geometry;
			birdTriangles += geometry.index ?
				geometry.index.count / 3 :
				geometry.attributes.position.count / 3;
		}
	});

	statsDiv.innerHTML = `
		Trees: ${trees}<br>
		Bird Components: ${birdComponents}<br>
		Flying Birds: ${flyingBirdCount}<br>
		Observers: ${personalityCount[BIRD_PERSONALITIES.OBSERVER]}<br>
		Patrollers: ${personalityCount[BIRD_PERSONALITIES.PATROL]}<br>
		Travelers: ${personalityCount[BIRD_PERSONALITIES.TRAVELER]}<br>
		Actives: ${personalityCount[BIRD_PERSONALITIES.ACTIVE]}<br>
		Bird Triangles: ${birdTriangles.toLocaleString()}
	`;
}

// 重新定位鸟类
function repositionBird(mode) {
	// 移除当前鸟类
	if (birdGroup.parent) {
		birdGroup.parent.remove(birdGroup);
	}

	// 重新加载鸟类（这里简化处理，实际应该重新创建或重置位置）
	if (mode === 'center') {
		// 场景中心
		const box = new THREE.Box3().setFromObject(birdGroup);
		const center = box.getCenter(new THREE.Vector3());
		birdGroup.position.sub(center);
		birdGroup.scale.set(0.5, 0.5, 0.5);
		console.log('Bird moved to scene center');
	} else {
		// 树枝上
		positionBirdOnTree();
	}

	// 重新添加到场景
	scene.add(birdGroup);
	render();
}

// ===================== 创建噪波地面材质 =====================
function createNoiseGround() {
	console.log('Creating noise-based ground with irregular displacement...');

	// 创建大的地面几何体
	const geometry = new THREE.PlaneGeometry(60, 60, 256, 256);
	geometry.rotateX(-Math.PI / 2); // 水平放置

	// 自定义着色器材质，实现静态随机噪波起伏
	const material = new THREE.ShaderMaterial({
		uniforms: {
			amplitude: { value: 3.0 }  // 起伏幅度
		},
		vertexShader: `
			uniform float amplitude;

			// 简化的噪声函数 - 基于位置生成静态随机值
			float hash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			float noise(vec2 p) {
				vec2 i = floor(p);
				vec2 f = fract(p);
				f = f * f * (3.0 - 2.0 * f);

				float a = hash(i);
				float b = hash(i + vec2(1.0, 0.0));
				float c = hash(i + vec2(0.0, 1.0));
				float d = hash(i + vec2(1.0, 1.0));

				return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
			}

			// 多层噪声叠加
			float fbm(vec2 p) {
				float value = 0.0;
				float amplitude = 1.0;
				float frequency = 0.01;

				for(int i = 0; i < 5; i++) {
					value += amplitude * noise(p * frequency);
					amplitude *= 0.5;
					frequency *= 2.0;
				}

				return value;
			}

			void main() {
				vec3 pos = position;

				// 生成静态随机噪波起伏
				float noiseValue = fbm(pos.xz);
				float displacement = (noiseValue - 0.5) * amplitude;

				// 应用位移
				pos.y += displacement;

				gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
			}
		`,
		fragmentShader: `
			void main() {
				// 半透明浅灰色地面
				vec3 color = vec3(0.7, 0.7, 0.7);
				gl_FragColor = vec4(color, 0.3);
			}
		`,
		side: THREE.DoubleSide
	});

	const ground = new THREE.Mesh(geometry, material);
	ground.position.y = -2; // 稍微下沉
	ground.receiveShadow = true;

	// 添加到场景
	forestGroup.add(ground);

	// 存储材质引用用于动画更新
	ground.userData.material = material;

	console.log('Noise-based ground created with fractal displacement');

	return ground;
}

// ===================== 生成90根延长树枝 =====================
function generateForest() {
	console.log('Creating 90 randomly distributed black curves...');

	const totalCurves = 90;
	const maxRadius = 25; // 圆形区域的最大半径
	const treeBaseRadius = 0.12; // 树干底部半径
	const minDistance = treeBaseRadius * 3; // 最小间距：1.5倍树干宽度（直径的两倍）

	// 清空全局树木位置数组，为新的森林生成做准备
	treePositions.length = 0;

	for (let curveIndex = 0; curveIndex < totalCurves; curveIndex++) {
		// 创建分段管状几何体 - 越向上越细
		const segments = 4 + Math.floor(Math.random() * 7); // 随机分成4-10段
		const group = new THREE.Group();

		// 在圆形区域内随机分布，确保最小间距
		let xOffset, zOffset, attempts = 0;
		do {
			const randomAngle = Math.random() * Math.PI * 2; // 随机角度 0-360°
			const randomRadius = Math.random() * maxRadius; // 随机半径 0-maxRadius
			xOffset = Math.cos(randomAngle) * randomRadius;
			zOffset = Math.sin(randomAngle) * randomRadius;
			attempts++;
		} while (attempts < 50 && treePositions.some(pos =>
			Math.sqrt((pos.x - xOffset) ** 2 + (pos.z - zOffset) ** 2) < minDistance
		));

		// 如果找不到合适位置，使用螺旋分布作为fallback
		if (attempts >= 50) {
			const angle = (curveIndex / totalCurves) * Math.PI * 4; // 4圈螺旋
			const radius = (angle / (Math.PI * 4)) * maxRadius;
			xOffset = Math.cos(angle) * radius;
			zOffset = Math.sin(angle) * radius;
		}

		// 创建该根曲线的路径点
		const points = [];
		const height = 10 + Math.random() * 10; // 随机总高度 10-20
		const baseAmplitude = 0.3; // 进一步减小振幅，几乎垂直向上

		// 生成轻微随机偏折的路径，从地平面(y=-1)开始
		for (let i = 0; i <= 200; i++) {
			const t = i / 200; // 归一化参数 0-1
			const y = -1 + t * height; // 从地平面(y=-1)开始生长到height

			// 极轻微的随机偏折 - 最小化横向偏移
			const randomX = Math.sin(t * Math.PI + Math.random() * Math.PI * 0.5) * baseAmplitude;
			const randomZ = Math.cos(t * Math.PI * 1.3 + Math.random() * Math.PI * 0.5) * baseAmplitude;

			// 几乎不添加额外噪声，保持最小偏折
			const x = (randomX * 0.95) + xOffset;
			const z = (randomZ * 0.95) + zOffset;

			points.push(new THREE.Vector3(x, y, z));
		}

		// 创建平滑曲线
		const curve = new THREE.CatmullRomCurve3(points);

		for (let i = 0; i < segments; i++) {
			const t1 = i / segments;
			const t2 = (i + 1) / segments;

			// 获取曲线段的起点和终点
			const point1 = curve.getPointAt(t1);
			const point2 = curve.getPointAt(t2);

			// 计算该段的半径（越向上越小，从0.12渐变到0.03）
			const baseRadius = 0.12;
			const minRadius = 0.03;
			const radius = baseRadius - (baseRadius - minRadius) * (i / segments);

			// 创建短线段
			const segmentPoints = [point1, point2];
			const segmentCurve = new THREE.CatmullRomCurve3(segmentPoints);
			const segmentGeometry = new THREE.TubeGeometry(segmentCurve, 2, radius, 8, false);

			const material = new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0.8,
				wireframe: true
			});

			const segment = new THREE.Mesh(segmentGeometry, material);
			group.add(segment);
		}

		// 存储树干信息用于鸟类定位
		treePositions.push({
			position: new THREE.Vector3(xOffset, height, zOffset),
			height: height,
			tree: group,
			scale: 1
		});

		forestGroup.add(group);
	}

	// 添加树林到场景
	scene.add(forestGroup);
	console.log('90 randomly distributed black curves created');

	// 更新统计信息
	updateSceneStats();
}

// ===================== 创建扭曲抖动线条 =====================
function createTwistingJitterLine() {
	console.log('Creating 40 smooth twisting jitter thick lines on ground...');

	const totalLines = 40; // 生成40条线条
	const maxRadius = 25; // 分布区域的最大半径

	for (let lineIndex = 0; lineIndex < totalLines; lineIndex++) {
		const lineGroup = new THREE.Group();
		const numPoints = 200; // 总点数，增加以获得更平滑的曲线
		const lineRadius = 0.3; // 线条半径（粗细）- 粗线条
		const overlapPoints = 3; // 重叠点数，确保分段连接平滑

		// 在圆形区域内随机分布线条位置
		const randomAngle = Math.random() * Math.PI * 2; // 随机角度 0-360°
		const randomRadius = Math.random() * maxRadius; // 随机半径 0-maxRadius
		const xOffset = Math.cos(randomAngle) * randomRadius;
		const zOffset = Math.sin(randomAngle) * randomRadius;

		// 生成扭曲抖动的路径点
		const points = [];
		for (let i = 0; i <= numPoints; i++) {
			const t = i / numPoints; // 0到1的参数
			const x = (t - 0.5) * 60 + xOffset; // 水平方向从-30到30 - 长度增加一倍

			// 创建柔和的抖动和扭曲效果 - 降低幅度避免纠缠
			const baseWave = Math.sin(t * Math.PI * 4) * 1.5; // 基础波形 - 幅度减半
			const jitter1 = Math.sin(t * Math.PI * 12 + Math.random() * Math.PI * 2) * 0.3; // 高频抖动 - 幅度降低
			const jitter2 = Math.cos(t * Math.PI * 8 + Math.random() * Math.PI * 2) * 0.2; // 中频抖动 - 幅度降低
			const twist = Math.sin(t * Math.PI * 6) * Math.cos(t * Math.PI * 3) * 0.5; // 扭曲效果 - 幅度降低

			const y = baseWave + jitter1 + jitter2 + twist;

			// Z方向的抖动 - 同样降低幅度
			const zJitter1 = Math.sin(t * Math.PI * 10 + Math.random() * Math.PI * 2) * 0.25;
			const zJitter2 = Math.cos(t * Math.PI * 14 + Math.random() * Math.PI * 2) * 0.15;
			const zTwist = Math.cos(t * Math.PI * 5) * Math.sin(t * Math.PI * 7) * 0.4;

			const z = zJitter1 + zJitter2 + zTwist + zOffset;

			points.push(new THREE.Vector3(x, y, z));
		}

		// 创建连续的管状分段，使用重叠点确保平滑连接
		const segmentSize = 20; // 每个分段包含的点数
		for (let i = 0; i < points.length - segmentSize; i += segmentSize - overlapPoints) {
			// 提取当前分段的点
			const segmentPoints = [];
			const endIndex = Math.min(i + segmentSize, points.length);
			for (let j = i; j < endIndex; j++) {
				segmentPoints.push(points[j]);
			}

			// 至少需要2个点才能创建曲线
			if (segmentPoints.length >= 2) {
				const curve = new THREE.CatmullRomCurve3(segmentPoints);

				// 创建管状几何体，增加tubularSegments以获得更平滑的表面
				const radius = lineRadius;
				const geometry = new THREE.TubeGeometry(curve, segmentPoints.length * 2, radius, 12, false);

				// 创建黑色材质
				const material = new THREE.MeshBasicMaterial({
					color: 0x000000, // 黑色
					transparent: true,
					opacity: 0.9
				});

				const tube = new THREE.Mesh(geometry, material);
				lineGroup.add(tube);
			}
		}

		// 设置线条位置 - 悬浮在虚空中的水平面位置
		lineGroup.position.set(0, 0, 0); // 虚空水平面位置

		// 添加到场景
		forestGroup.add(lineGroup);
	}

	console.log('40 smooth twisting jitter thick black lines created on ground');

	return;
}

// ===================== 生成多变静态扭曲树枝 =====================
function createStaticTwistedBranch(seed = Math.random(), lengthMultiplier = 1) {
	console.log('Creating varied static twisted branch...');

	// 种子随机函数，确保可重现的结果
	const random = (min, max) => {
		const x = Math.sin(seed * 10000 + min * 1000) * 10000;
		return min + (max - min) * (x - Math.floor(x));
	};

	// 随机化基本参数（保持合理范围）
	const baseLength = 4.5 + random(0, 2); // 基础长度4.5-6.5单位
	const length = baseLength * lengthMultiplier; // 应用长度倍数
	const curveAmount = random(0.3, 0.8); // 曲线程度
	const endX = random(-0.8, 0.8) * length * curveAmount; // 结束X位置
	const endZ = -length * (0.7 + random(0, 0.6)); // 结束Z位置

	const start = new THREE.Vector3(0, 0, 0);
	const end = new THREE.Vector3(endX, length, endZ);

	// 计算树枝长度和方向
	const direction = new THREE.Vector3().subVectors(end, start);
	const actualLength = direction.length();
	const segments = 7 + Math.floor(random(0, 4)); // 段数7-10
	const twistStrength = 0.5 + random(0, 0.6); // 扭曲强度0.5-1.1
	const baseRadius = 0.1 + random(0, 0.06); // 基础半径0.1-0.16

	// 创建扭曲的圆柱体几何体
	const geometry = new THREE.CylinderGeometry(
		baseRadius * (0.7 + random(0, 0.3)), // 顶部半径变化
		baseRadius * (1.0 + random(0, 0.4)), // 底部半径变化
		actualLength, 8, segments, false
	);

	// 应用半径变化和节瘤效果
	applyRadiusVariations(geometry, segments, random);

	// 手动调整顶点位置以创建扭曲和肿瘤效果
	applyVertexDeformations(geometry, segments, twistStrength, random);

	// 添加表面噪声
	addSurfaceNoise(geometry, random);

	// 创建颜色变化不大的材质
	const material = createVariedBarkMaterial(random);

	const branch = new THREE.Mesh(geometry, material);

	// 定位到中点并朝向末端
	const midPoint = new THREE.Vector3().lerpVectors(start, end, 0.5);
	branch.position.copy(midPoint);
	branch.lookAt(end);
	branch.rotateX(Math.PI / 2);

	// 存储树枝信息用于鸟类定位
	const branchHeight = length; // 树枝末端高度
	treePositions.push({
		position: new THREE.Vector3(0, branchHeight, 0),
		height: branchHeight,
		tree: branch,
		scale: 1
	});

	forestGroup.add(branch);

	// 添加不规则小分支
	addIrregularBranches(branch, start, end, segments, random);

	console.log('Varied static twisted branch created at center');
	return branch;
}

// ===================== 在指定位置创建延长树枝 =====================
function createExtendedBranchAt(x, z, seed) {
	// 种子随机函数
	const random = (min, max) => {
		const x = Math.sin(seed * 10000 + min * 1000) * 10000;
		return min + (max - min) * (x - Math.floor(x));
	};

	// 基础参数（与原函数相同但延长1倍）
	const baseLength = 4.5 + random(0, 2);
	const length = baseLength * 2; // 延长1倍
	const curveAmount = random(0.3, 0.8);
	const angleVariation = random(-0.2, 0.2); // 角度微变
	const endX = random(-0.8, 0.8) * length * curveAmount + angleVariation;
	const endZ = -length * (0.7 + random(0, 0.6));

	const start = new THREE.Vector3(x, 0, z);
	const end = new THREE.Vector3(x + endX, length, z + endZ);

	// 计算几何参数
	const direction = new THREE.Vector3().subVectors(end, start);
	const actualLength = direction.length();
	const segments = 7 + Math.floor(random(0, 4));
	const twistStrength = 0.5 + random(0, 0.6);
	const baseRadius = 0.1 + random(0, 0.06);

	// 创建几何体
	const geometry = new THREE.CylinderGeometry(
		baseRadius * (0.7 + random(0, 0.3)),
		baseRadius * (1.0 + random(0, 0.4)),
		actualLength, 8, segments, false
	);

	// 应用变形效果
	applyRadiusVariations(geometry, segments, random);
	applyVertexDeformations(geometry, segments, twistStrength, random);
	addSurfaceNoise(geometry, random);

	// 创建材质
	const material = createVariedBarkMaterial(random);

	// 创建网格
	const branch = new THREE.Mesh(geometry, material);

	// 定位到中点并朝向末端
	const midPoint = new THREE.Vector3().lerpVectors(start, end, 0.5);
	branch.position.copy(midPoint);
	branch.lookAt(end);
	branch.rotateX(Math.PI / 2);

	// 存储树枝信息用于鸟类定位
	const branchHeight = length; // 树枝末端高度
	treePositions.push({
		position: new THREE.Vector3(x, branchHeight, z),
		height: branchHeight,
		tree: branch,
		scale: 1
	});

	forestGroup.add(branch);

	// 添加不规则小分支
	addIrregularBranches(branch, start, end, segments, random);
}

// ===================== 应用半径变化和节瘤 =====================
function applyRadiusVariations(geometry, segments, random) {
	const positions = geometry.attributes.position.array;
	const radialSegments = geometry.parameters.radialSegments;

	for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex++) {
		const t = segmentIndex / segments;

		// 基础半径变化 - 模拟树枝的自然粗细变化
		const baseRadius = 0.08 + Math.sin(t * Math.PI * 2) * 0.02;

		// 节瘤效果 - 在某些位置添加半径增大
		const nodeEffect = Math.sin(t * Math.PI * 8) * 0.03;
		const radiusMultiplier = baseRadius + Math.max(0, nodeEffect);

		// 应用到该段的所有顶点
		for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
			const vertexIndex = segmentIndex * (radialSegments + 1) + radialIndex;
			const posIndex = vertexIndex * 3;

			if (posIndex < positions.length) {
				const x = positions[posIndex];
				const z = positions[posIndex + 2];
				const distance = Math.sqrt(x * x + z * z);

				if (distance > 0) {
					// 按比例缩放顶点到新的半径
					const scale = radiusMultiplier / distance;
					positions[posIndex] *= scale;
					positions[posIndex + 2] *= scale;
				}
			}
		}
	}
}

// ===================== 应用顶点变形（扭曲+肿瘤）=====================
function applyVertexDeformations(geometry, segments, twistStrength, random) {
	const positions = geometry.attributes.position.array;

	for (let i = 0; i < positions.length; i += 3) {
		const vertexIndex = Math.floor(i / 3);
		const radialIndex = vertexIndex % (geometry.parameters.radialSegments + 1);
		const segmentIndex = Math.floor(vertexIndex / (geometry.parameters.radialSegments + 1));
		const t = segmentIndex / segments;

		// 基础螺旋扭曲
		const twist = Math.sin(t * Math.PI * 2 + radialIndex * 0.5) * twistStrength;

		// 肿瘤/瘤状变化 - 在随机位置添加凸起
		const tumorSeed = (segmentIndex * 7 + radialIndex * 13) % 100;
		const tumorFactor = Math.sin(tumorSeed * 0.1) * Math.cos(tumorSeed * 0.15);
		const tumorStrength = Math.max(0, tumorFactor) * 0.15; // 较小的肿瘤效果

		// 应用变换
		positions[i] += twist * 0.25 + tumorStrength * 0.1;     // X方向
		positions[i + 1] += twist * 0.08 + tumorStrength * 0.08; // Y方向
		positions[i + 2] += Math.sin(t * Math.PI) * twistStrength * 0.15 + tumorStrength * 0.05; // Z方向
	}

	geometry.attributes.position.needsUpdate = true;
	geometry.computeVertexNormals();
}

// ===================== 添加表面噪声 =====================
function addSurfaceNoise(geometry, random) {
	const positions = geometry.attributes.position.array;
	const normals = geometry.attributes.normal.array;

	for (let i = 0; i < positions.length; i += 3) {
		const vertexIndex = Math.floor(i / 3);

		// 使用顶点索引生成伪随机噪声
		const noise1 = Math.sin(vertexIndex * 0.12) * Math.cos(vertexIndex * 0.18);
		const noise2 = Math.sin(vertexIndex * 0.27) * Math.cos(vertexIndex * 0.36);
		const noise3 = Math.sin(vertexIndex * 0.52) * Math.cos(vertexIndex * 0.61);

		// 沿法线方向添加小的位移
		const normalX = normals[i];
		const normalY = normals[i + 1];
		const normalZ = normals[i + 2];

		const noiseStrength = 0.015;
		positions[i] += normalX * noise1 * noiseStrength;
		positions[i + 1] += normalY * noise2 * noiseStrength;
		positions[i + 2] += normalZ * noise3 * noiseStrength;
	}
}

// ===================== 创建树皮材质 =====================
function createVariedBarkMaterial(random) {
	// 基础棕褐色
	const baseR = 0x8B / 255; // 139
	const baseG = 0x45 / 255; // 69
	const baseB = 0x13 / 255; // 19

	// 小的颜色变化（±15%）
	const colorVariation = 0.15;
	const r = baseR * (1 + random(-colorVariation, colorVariation));
	const g = baseG * (1 + random(-colorVariation, colorVariation));
	const b = baseB * (1 + random(-colorVariation, colorVariation));

	// 确保颜色在合理范围内
	const clampedR = Math.max(0.3, Math.min(0.9, r));
	const clampedG = Math.max(0.2, Math.min(0.7, g));
	const clampedB = Math.max(0.05, Math.min(0.4, b));

	const color = new THREE.Color(clampedR, clampedG, clampedB);

	return new THREE.MeshStandardMaterial({
		color: color,
		roughness: 0.85 + random(0, 0.1),
		metalness: random(0, 0.05)
	});
}

// ===================== 添加不规则小分支 =====================
function addIrregularBranches(mainBranch, start, end, segments, random) {
	const branchCount = Math.floor(random(0, 3)); // 0-2个分支

	for (let i = 0; i < branchCount; i++) {
		const branchSegment = Math.floor(random(1, segments - 1));
		const t = branchSegment / segments;

		// 分支起点位置
		const branchStart = new THREE.Vector3().lerpVectors(start, end, t);

		// 分支方向 - 随机角度
		const branchAngle = random(0, Math.PI * 2);
		const branchLength = 0.6 + random(0, 0.8);
		const branchDirection = new THREE.Vector3(
			Math.cos(branchAngle) * branchLength,
			random(-0.3, 0.5) * branchLength,
			Math.sin(branchAngle) * branchLength
		);

		const branchEnd = branchStart.clone().add(branchDirection);

		// 创建小分支（更简单的几何体）
		const subGeometry = new THREE.CylinderGeometry(
			0.03 + random(0, 0.02), 0.02 + random(0, 0.01),
			branchLength, 4, 3, false
		);

		// 简单的扭曲
		const subPositions = subGeometry.attributes.position.array;
		for (let j = 0; j < subPositions.length; j += 3) {
			const vertexIdx = Math.floor(j / 3);
			const segmentIdx = Math.floor(vertexIdx / 5);
			const subT = segmentIdx / 3;
			const subTwist = Math.sin(subT * Math.PI) * 0.1;
			subPositions[j] += subTwist * 0.05;
		}
		subGeometry.attributes.position.needsUpdate = true;
		subGeometry.computeVertexNormals();

		const subMaterial = createVariedBarkMaterial(random);
		const subBranch = new THREE.Mesh(subGeometry, subMaterial);

		// 定位分支
		const subMidPoint = new THREE.Vector3().lerpVectors(branchStart, branchEnd, 0.5);
		subBranch.position.copy(subMidPoint);
		subBranch.lookAt(branchEnd);
		subBranch.rotateX(Math.PI / 2);

		mainBranch.add(subBranch);
	}
}

// 创建程序化树木（使用点和线的抽象表示）
function createProceduralTree() {
	const treeGroup = new THREE.Group();
	console.log('Starting to create trees...');

	// 树干 - 用线条表示
	createTreeTrunk(treeGroup);

	// 树冠 - 用点云表示
	createTreeCrown(treeGroup);

	// 分支 - 用线条表示
	createTreeBranches(treeGroup);

	console.log('Tree creation completed, containing', treeGroup.children.length, 'child objects');
	return treeGroup;
}

// 创建树干（使用简单的直线或轻微弯曲的线条表示）
function createTreeTrunk(treeGroup) {
	const trunkPoints = [];
	const trunkHeight = 6;
	const trunkType = Math.floor(Math.random() * 3); // 0=直线, 1=轻微波形, 2=简单折线

	switch (trunkType) {
		case 0: // 直线树干
			trunkPoints.push(new THREE.Vector3(0, 0, 0));
			trunkPoints.push(new THREE.Vector3(0, trunkHeight, 0));
        break;

		case 1: // 轻微波形树干
			const segments = 8;
			for (let i = 0; i <= segments; i++) {
				const t = i / segments;
				const y = t * trunkHeight;
				const wave = Math.sin(t * Math.PI * 2) * 0.05; // 轻微波形
				const x = wave;
				const z = 0;
				trunkPoints.push(new THREE.Vector3(x, y, z));
			}
			break;

		case 2: // 简单折线树干
			const midHeight = trunkHeight * 0.6;
			const offset = 0.1;
			trunkPoints.push(new THREE.Vector3(0, 0, 0));
			trunkPoints.push(new THREE.Vector3(offset, midHeight, 0));
			trunkPoints.push(new THREE.Vector3(0, trunkHeight, 0));
        break;
    }

	// 使用线条表示树干
	const trunkGeometry = new THREE.BufferGeometry().setFromPoints(trunkPoints);
	const trunkMaterial = new THREE.LineBasicMaterial({
		color: 0x3d2817,
		transparent: true,
		opacity: 0.9,
		linewidth: 3
	});

	const trunk = new THREE.Line(trunkGeometry, trunkMaterial);
	treeGroup.add(trunk);
}

// 创建树冠（分层点云）
function createTreeCrown(treeGroup) {
	// 创建多层树冠效果
	const layers = 3;
	const layerHeight = 2;

	for (let layer = 0; layer < layers; layer++) {
		const crownPoints = [];
		const pointCount = 80 + Math.floor(Math.random() * 40); // 每层80-120个点

		const layerCenterY = 5 + layer * layerHeight * 0.7; // 层间重叠
		const layerRadius = 3.5 - layer * 0.5; // 越高层越小

		// 生成该层的点云
		for (let i = 0; i < pointCount; i++) {
			const phi = Math.random() * Math.PI * 0.8; // 限制角度，避免向下太多
			const theta = Math.random() * Math.PI * 2;

			const radius = Math.pow(Math.random(), 0.7) * layerRadius; // 更均匀的分布

			const x = radius * Math.sin(phi) * Math.cos(theta);
			const y = layerCenterY + (Math.random() - 0.3) * layerHeight + radius * Math.cos(phi) * 0.3;
			const z = radius * Math.sin(phi) * Math.sin(theta);

			// 添加一些不规则性
			const noise = (Math.random() - 0.5) * 0.5;
			crownPoints.push(new THREE.Vector3(x + noise, y + noise, z + noise));
		}

		const crownGeometry = new THREE.BufferGeometry().setFromPoints(crownPoints);

		// 每层使用不同的材质设置
		const size = 0.12 - layer * 0.03; // 越高层点越小
		const opacity = 0.9 - layer * 0.2; // 越高层越透明

		const crownMaterial = new THREE.PointsMaterial({
			size: size,
			transparent: true,
			opacity: opacity,
			vertexColors: true
		});

		// 颜色渐变：从底部深绿到顶部亮绿
		const colors = [];
		const layerColors = [
			new THREE.Color(0x1a3d0f), // 最底层深绿
			new THREE.Color(0x2d5016), // 中间层
			new THREE.Color(0x4a7c2a), // 最上层亮绿
		];

		const baseColor = layerColors[layer];

		crownPoints.forEach((point) => {
			const color = baseColor.clone();

			// 添加基于位置的颜色变化
			const heightVariation = (point.y - 4) / 6; // 0-1
			color.r += heightVariation * 0.2;
			color.g += heightVariation * 0.3;
			color.b += heightVariation * 0.1;

			// 随机颜色变化
			color.r += (Math.random() - 0.5) * 0.15;
			color.g += (Math.random() - 0.5) * 0.15;
			color.b += (Math.random() - 0.5) * 0.15;

			colors.push(color.r, color.g, color.b);
		});

		crownGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		const crown = new THREE.Points(crownGeometry, crownMaterial);
		treeGroup.add(crown);
	}
}

// 创建树枝（使用直线、斜线、折线表示）
function createTreeBranches(treeGroup) {
	const branchCount = 6 + Math.floor(Math.random() * 6); // 6-11个分支

	for (let i = 0; i < branchCount; i++) {
		// 分支起始点（在树干上随机高度）
		const startHeight = 1.5 + Math.random() * 4.5; // 1.5-6米高度
		const startRadius = 0.08;
		const startAngle = Math.random() * Math.PI * 2;

		const startX = Math.cos(startAngle) * startRadius;
		const startZ = Math.sin(startAngle) * startRadius;

		// 分支参数
		const branchLength = 1.5 + Math.random() * 3; // 1.5-4.5米
		const branchType = Math.floor(Math.random() * 3); // 0=直线, 1=斜线, 2=折线

		let branchPoints = [];
		let endPoint;

		switch (branchType) {
			case 0: // 直线分支
				endPoint = createStraightBranch(startX, startHeight, startZ, branchLength, startAngle);
				branchPoints = [new THREE.Vector3(startX, startHeight, startZ), endPoint];
				break;

			case 1: // 斜线分支
				endPoint = createDiagonalBranch(startX, startHeight, startZ, branchLength, startAngle);
				branchPoints = [new THREE.Vector3(startX, startHeight, startZ), endPoint];
				break;

			case 2: // 折线分支
				branchPoints = createZigzagBranch(startX, startHeight, startZ, branchLength, startAngle);
				endPoint = branchPoints[branchPoints.length - 1];
				break;
		}

		// 使用线条表示分支
		const branchGeometry = new THREE.BufferGeometry().setFromPoints(branchPoints);
		const branchMaterial = new THREE.LineBasicMaterial({
			color: 0x2d2418,
			transparent: true,
			opacity: 0.8,
			linewidth: 2
		});

		const branch = new THREE.Line(branchGeometry, branchMaterial);
		treeGroup.add(branch);

		// 在分支末端添加叶子簇
		createBranchLeaves(treeGroup, endPoint, branchLength * 0.3);
	}
}

// 创建直线分支
function createStraightBranch(startX, startY, startZ, length, baseAngle) {
	const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 0.8; // 随机方向
	const pitch = (Math.random() - 0.3) * Math.PI * 0.6; // -0.3π 到 0.3π，避免过度向上

	const endX = startX + Math.sin(pitch) * Math.cos(angle) * length;
	const endY = startY + Math.cos(pitch) * length;
	const endZ = startZ + Math.sin(pitch) * Math.sin(angle) * length;

	return new THREE.Vector3(endX, endY, endZ);
}

// 创建斜线分支
function createDiagonalBranch(startX, startY, startZ, length, baseAngle) {
	const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.0; // 更大的角度变化
	const pitch = (Math.random() - 0.4) * Math.PI * 0.8; // -0.4π 到 0.4π，更大角度范围

	const endX = startX + Math.sin(pitch) * Math.cos(angle) * length;
	const endY = startY + Math.cos(pitch) * length;
	const endZ = startZ + Math.sin(pitch) * Math.sin(angle) * length;

	return new THREE.Vector3(endX, endY, endZ);
}

// 创建折线分支
function createZigzagBranch(startX, startY, startZ, length, baseAngle) {
	const points = [new THREE.Vector3(startX, startY, startZ)];
	let currentX = startX;
	let currentY = startY;
	let currentZ = startZ;

	// 创建2-4个折点
	const segmentCount = 2 + Math.floor(Math.random() * 3);
	const segmentLength = length / segmentCount;

	for (let i = 0; i < segmentCount; i++) {
		const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.2; // 每个段落随机角度
		const pitch = (Math.random() - 0.5) * Math.PI * 0.7; // -0.5π 到 0.2π，更大角度变化

		currentX += Math.sin(pitch) * Math.cos(angle) * segmentLength;
		currentY += Math.cos(pitch) * segmentLength;
		currentZ += Math.sin(pitch) * Math.sin(angle) * segmentLength;

		points.push(new THREE.Vector3(currentX, currentY, currentZ));
	}

	return points;
}

// 创建分支末端的叶子簇
function createBranchLeaves(treeGroup, branchEnd, leafSpread) {
	const leafPoints = [];
	const leafCount = 15 + Math.floor(Math.random() * 15); // 15-30片叶子

	for (let k = 0; k < leafCount; k++) {
		// 在分支末端周围分布叶子
		const distance = Math.random() * leafSpread;
		const angle1 = Math.random() * Math.PI * 2;
		const angle2 = Math.random() * Math.PI * 0.6; // 限制向上角度

		const lx = branchEnd.x + distance * Math.sin(angle2) * Math.cos(angle1);
		const ly = branchEnd.y + distance * Math.cos(angle2) + Math.random() * 0.3;
		const lz = branchEnd.z + distance * Math.sin(angle2) * Math.sin(angle1);

		leafPoints.push(new THREE.Vector3(lx, ly, lz));
	}

	const leafGeometry = new THREE.BufferGeometry().setFromPoints(leafPoints);

	// 创建更丰富的叶子颜色变化
	const leafMaterial = new THREE.PointsMaterial({
		size: 0.06 + Math.random() * 0.04, // 随机大小
		transparent: true,
		opacity: 0.8,
		vertexColors: true
	});

	// 为叶子设置颜色渐变
	const colors = [];
	const leafColors = [
		new THREE.Color(0x2d5016), // 深绿
		new THREE.Color(0x4a7c2a), // 中绿
		new THREE.Color(0x6b9e4a), // 亮绿
		new THREE.Color(0x8bc34a), // 黄绿
	];

	leafPoints.forEach((point, index) => {
		const colorIndex = Math.floor(Math.random() * leafColors.length);
		const baseColor = leafColors[colorIndex].clone();

		// 添加随机变化
		baseColor.r += (Math.random() - 0.5) * 0.1;
		baseColor.g += (Math.random() - 0.5) * 0.1;
		baseColor.b += (Math.random() - 0.5) * 0.1;

		colors.push(baseColor.r, baseColor.g, baseColor.b);
	});

	leafGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	const leaves = new THREE.Points(leafGeometry, leafMaterial);
	treeGroup.add(leaves);
}

// 添加光照和雾效果
function addLightingAndFog() {
		// 添加淡灰色雾效果
		const lightGray = 0xcccccc;
		scene.fog = new THREE.Fog(lightGray, 20, 50);
	// 环境光
	const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
	forestGroup.add(ambientLight);

	// 主方向光（模拟阳光）
	const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
	directionalLight.position.set(10, 20, 5);
	directionalLight.castShadow = true;

	// 配置阴影
	directionalLight.shadow.mapSize.width = 2048;
	directionalLight.shadow.mapSize.height = 2048;
	directionalLight.shadow.camera.near = 0.5;
	directionalLight.shadow.camera.far = 50;
	directionalLight.shadow.camera.left = -30;
	directionalLight.shadow.camera.right = 30;
	directionalLight.shadow.camera.top = 30;
	directionalLight.shadow.camera.bottom = -30;

	forestGroup.add(directionalLight);

	// 补充光源
	const fillLight = new THREE.DirectionalLight(0x87CEEB, 0.4);
	fillLight.position.set(-5, 10, -5);
	forestGroup.add(fillLight);
}

async function loadBirdComponentsNew() {
	// 使用组件库创建完整的鸟类组合体
	const birdMesh = createBirdFromComponents();
	if (birdMesh) {
		// 设置静态鸟类的大小和位置
		birdMesh.scale.set(0.5, 0.5, 0.5);
		birdMesh.position.set(0, 2, 0); // 放在场景中心稍微高一点的位置

		// 添加到场景
		birdGroup.add(birdMesh);
		console.log('Static bird assembly created');
  } else {
		console.warn('无法创建静态鸟类组合体');
	}
}

// 旧的加载函数（保留用于兼容性）
async function loadBirdComponents() {
	const loader = createGLTFLoader();
	const components = [
		{ name: 'chest', path: '/models/bird_components/chest/chest_01.glb', position: [0, 0, 0], rotation: [0, 0, 0] },
		{ name: 'head', path: '/models/bird_components/head/head_01.glb', position: [0, 1.0, 0.2], rotation: [0, 0, 0] },
		{ name: 'belly', path: '/models/bird_components/belly/belly_01.glb', position: [0, -0.8, 0], rotation: [0, 0, 0] },
		{ name: 'leftWing', path: '/models/bird_components/wing/wing_01.glb', position: [-1.2, 0, 0.1], rotation: [0, 0, -0.3] },
		{ name: 'rightWing', path: '/models/bird_components/wing/wing_02.glb', position: [1.2, 0, 0.1], rotation: [0, 0, 0.3] },
		{ name: 'tail', path: '/models/bird_components/tail/tail_01.glb', position: [0, -1.0, -1.0], rotation: [0.2, 0, 0] },
		{ name: 'leftFoot', path: '/models/bird_components/foot/foot_01.glb', position: [-0.3, -1.2, 0.2], rotation: [0, 0, 0] },
		{ name: 'rightFoot', path: '/models/bird_components/foot/foot_02.glb', position: [0.3, -1.2, 0.2], rotation: [0, 0, 0] }
	];

	let loadedCount = 0;
	const totalComponents = components.length;

	console.log(`Starting to load ${totalComponents} bird components...`);

	for (const component of components) {
		try {
			console.log(`加载 ${component.name}: ${component.path}`);

			const gltf = await loader.loadAsync(component.path);
			const model = gltf.scene;

			// 处理材质问题 - 确保所有材质都是标准材质
			model.traverse((child) => {
				if (child.isMesh && child.material) {
					try {
						// 处理材质数组
						const materials = Array.isArray(child.material) ? child.material : [child.material];

						for (let i = 0; i < materials.length; i++) {
							const material = materials[i];

							// 检查材质类型并转换
							if (!(material instanceof THREE.MeshStandardMaterial)) {
								console.log(`Converting material ${i}: ${material.constructor.name} -> MeshStandardMaterial`);

								const newMaterial = new THREE.MeshStandardMaterial();

								// 安全地复制属性
								try {
									if (material.color && material.color.isColor) {
										newMaterial.color.copy(material.color);
      } else {
										newMaterial.color.setHex(0x888888);
									}

									// 复制纹理
									if (material.map) newMaterial.map = material.map;
									if (material.normalMap) newMaterial.normalMap = material.normalMap;
									if (material.roughnessMap) newMaterial.roughnessMap = material.roughnessMap;
									if (material.metalnessMap) newMaterial.metalnessMap = material.metalnessMap;
									if (material.emissiveMap) newMaterial.emissiveMap = material.emissiveMap;

									// 复制数值属性
									if (typeof material.roughness === 'number') newMaterial.roughness = material.roughness;
									if (typeof material.metalness === 'number') newMaterial.metalness = material.metalness;
									if (typeof material.emissiveIntensity === 'number') newMaterial.emissiveIntensity = material.emissiveIntensity;

									// 设置默认值
									newMaterial.roughness = newMaterial.roughness || 0.1;
									newMaterial.metalness = newMaterial.metalness || 0.9;

								} catch (propError) {
									console.warn(`复制材质属性失败:`, propError);
								}

								// 移除可能有问题的回调和属性
								if (newMaterial.onBuild) delete newMaterial.onBuild;
								if (newMaterial.onBeforeCompile) delete newMaterial.onBeforeCompile;

								materials[i] = newMaterial;
							} else {
								// 已经是标准材质，也要清理可能有问题的属性
								if (material.onBuild) delete material.onBuild;
								if (material.onBeforeCompile) delete material.onBeforeCompile;
							}
						}

						// 更新材质引用
						child.material = materials.length === 1 ? materials[0] : materials;

					} catch (error) {
						console.error(`处理材质失败，使用默认材质:`, error);
						child.material = new THREE.MeshStandardMaterial({
							color: 0x888888,
							roughness: 0.1, // PBR属性：低粗糙度
							metalness: 0.9  // PBR属性：高金属度
        });
      }
    }
			});

			// 设置组件名称和位置
			model.name = component.name;
			model.position.set(...component.position);
			model.rotation.set(...component.rotation);

			// 设置用户数据
			model.userData.partType = component.name;
			model.userData.componentPath = component.path;

			// 添加到鸟类组
			birdGroup.add(model);

			loadedCount++;
			console.log(`✅ ${component.name} loading completed (${loadedCount}/${totalComponents})`);

		} catch (error) {
			console.error(`❌ ${component.name} 加载失败:`, error);
			loadedCount++;
		}
	}

	// 所有组件加载完成后添加到场景
	console.log('All components loaded, adding to scene...');

	// WebGL 渲染器会在首次渲染时自动编译着色器，无需手动预编译
	console.log('Adding bird assembly to scene');
	scene.add(birdGroup);

	// 将鸟类放置在树枝上（暂时保持场景中心作为测试）
	// positionBirdOnTree();

	// 或者保持居中显示作为测试
	const box = new THREE.Box3().setFromObject(birdGroup);
	const center = box.getCenter(new THREE.Vector3());
	birdGroup.position.sub(center);

	// 调整整体大小
	const scale = 0.5; // 从 2.0 调整为 0.8，使模型更小
	birdGroup.scale.set(scale, scale, scale);

	console.log('Bird assembly added to scene (center test)');

	// 更新统计信息
	updateSceneStats();

	render();
}

// 将鸟类放置在树枝上
function positionBirdOnTree() {
	if (treePositions.length === 0) {
		console.warn('没有树木可用，使用默认位置');
		return;
	}

	// 选择一棵树（暂时选择第一棵作为测试）
	const selectedTree = treePositions[0];
	const treePos = selectedTree.position;
	const treeHeight = selectedTree.height;

	// 在树冠中选择一个位置
	const branchOffset = new THREE.Vector3(
		(Math.random() - 0.5) * 4, // X偏移
		Math.random() * 3 + 4 + window.debugParams.heightOffset, // Y位置（树冠高度范围）+ 全局高度偏移
		(Math.random() - 0.5) * 4  // Z偏移
	);

	const birdPosition = treePos.clone().add(branchOffset);
	birdGroup.position.copy(birdPosition);

	// 调整鸟类朝向（面向树干）
	const treeDirection = treePos.clone().sub(birdPosition).normalize();
	const lookAtTarget = birdPosition.clone().add(treeDirection.multiplyScalar(10));
	birdGroup.lookAt(lookAtTarget.x, birdPosition.y, lookAtTarget.z);

	// 调整整体大小（树上的鸟类应该更小）
	const scale = 0.3; // 更小的尺寸适合树上
	birdGroup.scale.set(scale, scale, scale);

	console.log(`Bird placed on tree: position(${birdPosition.x.toFixed(1)}, ${birdPosition.y.toFixed(1)}, ${birdPosition.z.toFixed(1)})`);
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	render();
}

function render() {
	if (renderer) {
		renderer.render(scene, camera);
	}
}

// 设置鼠标选择事件处理器
function setupMouseSelection() {
	const canvas = renderer.domElement;

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
}

// 鼠标按下事件
function onPointerDown(event) {
	// 阻止OrbitControls的默认行为
    event.preventDefault();

	// 双击检测
	const currentTime = Date.now();
	const timeDiff = currentTime - lastClickTime;

	if (timeDiff < DOUBLE_CLICK_DELAY) {
		// 双击检测成功，检查是否点击了鸟类
		handleDoubleClick(event);
		return;
	}

	lastClickTime = currentTime;

	// 获取鼠标位置（标准化设备坐标）
	const rect = renderer.domElement.getBoundingClientRect();
	const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	// 射线检测
const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

	// 检测场景中的对象（只检测鸟类组合体）
	const birdObjects = [];
	scene.traverse((child) => {
		if (child.name === 'RandomBirdAssembly' || child.userData?.isBird) {
			birdObjects.push(child);
		}
	});

	const intersects = raycaster.intersectObjects(birdObjects, true);

  if (intersects.length > 0) {
		// 找到最接近的鸟类对象
		let selectedBird = intersects[0].object;
		while (selectedBird.parent && selectedBird.parent.name !== 'RandomBirdAssembly' && !selectedBird.parent.userData?.isBird) {
			selectedBird = selectedBird.parent;
		}

		// 开始长按选择
		selectionState.isSelecting = true;
		selectionState.startTime = Date.now();
		selectionState.pointerStartPos = { x: event.clientX, y: event.clientY };
		selectionState.selectedObject = selectedBird;

		// 创建进度环UI
		createProgressRing(event.clientX, event.clientY);
		// 开始相机聚焦（与读条时长同步）
		startCameraFocus(selectedBird, SELECTION_REQUIRED_TIME);
	}
}

// 双击处理函数
function handleDoubleClick(event) {
	// 获取鼠标位置（标准化设备坐标）
	const rect = renderer.domElement.getBoundingClientRect();
	const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	// 射线检测
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

	// 检测场景中的对象（只检测鸟类组合体）
	const birdObjects = [];
	flyingBirds.forEach(bird => {
		if (bird && bird.alive && bird.mesh) {
			birdObjects.push(bird.mesh);
		}
	});

	const intersects = raycaster.intersectObjects(birdObjects, true);

	if (intersects.length > 0) {
		// 找到点击的鸟类
		let clickedBird = null;
		for (const bird of flyingBirds) {
			if (bird && bird.alive && bird.mesh) {
				// 检查是否点击了这个鸟类的任何部件
				const birdIntersects = raycaster.intersectObject(bird.mesh, true);
				if (birdIntersects.length > 0) {
					clickedBird = bird;
					break;
				}
			}
		}

		if (clickedBird) {
			enterObservationMode(clickedBird);
		}
	}
}

// 鼠标移动事件
function onPointerMove(event) {
	if (!selectionState.isSelecting) return;

	// 检查鼠标移动距离是否超过阈值
	const dx = event.clientX - selectionState.pointerStartPos.x;
	const dy = event.clientY - selectionState.pointerStartPos.y;
	const distance = Math.sqrt(dx * dx + dy * dy);

	if (distance > 8) { // 8px 移动阈值
		cancelSelection();
	}
}

// 鼠标释放事件
function onPointerUp(event) {
	if (!selectionState.isSelecting) return;

	const elapsed = Date.now() - selectionState.startTime;
	const requiredTime = SELECTION_REQUIRED_TIME; // 与聚焦时长同步

	if (elapsed >= requiredTime) {
		// 成功选择
		completeSelection(selectionState.selectedObject);
    } else {
		// 时间不够，取消选择
		cancelSelection();
	}
}

// 创建进度环UI
function createProgressRing(x, y) {
	// 移除现有的进度环
	if (selectionState.progressElement) {
		document.body.removeChild(selectionState.progressElement);
	}

	// 创建SVG进度环
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', '60');
	svg.setAttribute('height', '60');
	svg.setAttribute('viewBox', '0 0 60 60');
	svg.style.position = 'absolute';
	svg.style.left = `${x - 30}px`;
	svg.style.top = `${y - 30}px`;
	svg.style.pointerEvents = 'none';
	svg.style.zIndex = '1000';

	// 背景圆环
	const background = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	background.setAttribute('cx', '30');
	background.setAttribute('cy', '30');
	background.setAttribute('r', '25');
	background.setAttribute('fill', 'none');
	background.setAttribute('stroke', 'rgba(255,255,255,0.3)');
	background.setAttribute('stroke-width', '3');

	// 进度圆环
	const progress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	progress.setAttribute('cx', '30');
	progress.setAttribute('cy', '30');
	progress.setAttribute('r', '25');
	progress.setAttribute('fill', 'none');
	progress.setAttribute('stroke', 'rgba(0,255,0,0.8)');
	progress.setAttribute('stroke-width', '3');
	progress.setAttribute('stroke-dasharray', '157'); // 2 * π * 25
	progress.setAttribute('stroke-dashoffset', '157');
	progress.setAttribute('transform', 'rotate(-90 30 30)'); // 从12点钟方向开始

	svg.appendChild(background);
	svg.appendChild(progress);
	document.body.appendChild(svg);

	selectionState.progressElement = svg;
	selectionState.animationId = null;

	// 启动动画
	const startTime = Date.now();
	const duration = 1800; // 1.8秒 (60% of 3秒)

	function animate() {
		if (!selectionState.isSelecting) return;

		const elapsed = Date.now() - startTime;
		const progressValue = Math.min(elapsed / duration, 1);

		// 更新进度圆环
		const circumference = 2 * Math.PI * 25;
		const dashOffset = circumference * (1 - progressValue);
		progress.setAttribute('stroke-dashoffset', dashOffset.toString());

		if (progressValue < 1) {
			selectionState.animationId = requestAnimationFrame(animate);
		} else {
			// 进度完成，自动消失
			setTimeout(() => {
				if (selectionState.progressElement && selectionState.progressElement.parentNode) {
					document.body.removeChild(selectionState.progressElement);
					selectionState.progressElement = null;
				}
				if (selectionState.animationId) {
					cancelAnimationFrame(selectionState.animationId);
					selectionState.animationId = null;
				}
			}, 200); // 短暂延迟，让用户看到完成状态
		}
	}

	selectionState.animationId = requestAnimationFrame(animate);
}

// 取消选择
function cancelSelection() {
	selectionState.isSelecting = false;

	if (selectionState.progressElement) {
		document.body.removeChild(selectionState.progressElement);
		selectionState.progressElement = null;
	}

	if (selectionState.animationId) {
		cancelAnimationFrame(selectionState.animationId);
		selectionState.animationId = null;
	}

	// 取消相机聚焦（回退到原始视角）
	cancelCameraFocus();

	selectionState.selectedObject = null;
}

// 完成选择
function completeSelection(selectedObject) {
	selectionState.isSelecting = false;

	if (selectionState.progressElement) {
		document.body.removeChild(selectionState.progressElement);
		selectionState.progressElement = null;
	}

	if (selectionState.animationId) {
		cancelAnimationFrame(selectionState.animationId);
		selectionState.animationId = null;
	}

	// 视觉反馈：让选中对象发光
	flashSelectedObject(selectedObject);

	// 捕获鸟类组合体
	// 完成选择后保持相机聚焦，然后捕获组合体
	finalizeCameraFocus();
	captureBirdAssembly(selectedObject);

	selectionState.selectedObject = null;
}

// 视觉反馈：闪烁选中对象
function flashSelectedObject(object) {
	if (!object) return;

	// 保存原始材质
	const originalMaterials = new Map();

	object.traverse((child) => {
		if (child.isMesh && child.material) {
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			originalMaterials.set(child, materials.map(mat => mat.clone()));

			// 设置发光效果
			materials.forEach(mat => {
				if (mat.emissive) {
					mat.emissive.setHex(0x444444);
				}
			});
		}
	});

	// 500ms后恢复
	setTimeout(() => {
		object.traverse((child) => {
			if (child.isMesh && originalMaterials.has(child)) {
				child.material = originalMaterials.get(child).length === 1 ?
					originalMaterials.get(child)[0] : originalMaterials.get(child);
			}
		});
	}, 500);
}

// 捕获鸟类组合体
function captureBirdAssembly(birdAssembly) {
	console.log('开始捕获鸟类组合体:', birdAssembly.name, birdAssembly);

	if (capturedBirds.length >= 10) {
		console.warn('胶卷已满，无法捕获更多鸟类组合体');
		showToast('Film roll is full (maximum 10)');
		return;
	}

	// 序列化组合体数据
	const captureData = serializeBirdAssembly(birdAssembly);

	// 生成缩略图
	generateThumbnail(birdAssembly).then(thumbnailDataURL => {
		captureData.thumbnail = thumbnailDataURL;

		// 添加到捕获列表
		capturedBirds.push(captureData);

		// 更新胶卷UI
		updateFilmRollUI(capturedBirds.length);

		console.log('鸟类组合体已捕获:', captureData.id);
		showToast(`Capture successful! Current ${capturedBirds.length}/10`);
	});
}

// 序列化鸟类组合体 - 简化版：保存文件路径和类型
function serializeBirdAssembly(birdAssembly) {
	const captureData = {
		id: generateUUID(),
		timestamp: Date.now(),
		components: [], // 保存 {partType, filePath} 数组
		transform: {
			position: birdAssembly.position.clone(),
			rotation: birdAssembly.rotation.clone(),
			scale: birdAssembly.scale.clone()
		}
	};

	// 提取组件文件路径和类型信息
	birdAssembly.traverse((child) => {
		if (child.userData && child.userData.fileName && child.userData.partType) {
			const filePath = `/models/bird_components/${child.userData.partType}/${child.userData.fileName}`;
			captureData.components.push({
				partType: child.userData.partType,
				filePath: filePath
			});
		}
	});

	console.log('序列化完成，提取到', captureData.components.length, '个组件');

	return captureData;
}

// 生成缩略图（离屏渲染）
function generateThumbnail(birdAssembly) {
	return new Promise((resolve) => {
		// 创建离屏渲染器
		const offscreenRenderer = new THREE.WebGLRenderer({
			antialias: false,
			alpha: true
		});
		offscreenRenderer.setSize(256, 256);
		offscreenRenderer.shadowMap.enabled = true;

		// 创建临时场景和相机
		const tempScene = new THREE.Scene();
		tempScene.background = new THREE.Color(0xf0f0f0); // 浅灰色背景

		const tempCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		tempCamera.position.set(5, 5, 5);
		tempCamera.lookAt(0, 0, 0);

		// 添加环境光
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
		tempScene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(5, 5, 5);
		directionalLight.castShadow = true;
		tempScene.add(directionalLight);

		// 克隆鸟类组合体
		const clonedAssembly = birdAssembly.clone();
		clonedAssembly.position.set(0, 0, 0);
		clonedAssembly.rotation.set(0, 0, 0);

		// 确保所有网格都可见并有阴影
		clonedAssembly.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		tempScene.add(clonedAssembly);

		// 渲染到离屏缓冲区
		offscreenRenderer.render(tempScene, tempCamera);

		// 读取像素数据
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 256;
		const context = canvas.getContext('2d');

		// 从WebGL渲染器复制到canvas
		const gl = offscreenRenderer.getContext();
		const pixels = new Uint8Array(256 * 256 * 4);
		gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// 翻转图像（WebGL坐标系是左下角为原点）
		const imageData = context.createImageData(256, 256);
		for (let y = 0; y < 256; y++) {
			for (let x = 0; x < 256; x++) {
				const srcIndex = (y * 256 + x) * 4;
				const dstIndex = ((255 - y) * 256 + x) * 4;
				imageData.data[dstIndex] = pixels[srcIndex];     // R
				imageData.data[dstIndex + 1] = pixels[srcIndex + 1]; // G
				imageData.data[dstIndex + 2] = pixels[srcIndex + 2]; // B
				imageData.data[dstIndex + 3] = pixels[srcIndex + 3]; // A
			}
		}

		context.putImageData(imageData, 0, 0);

		// 转换为DataURL
		const dataURL = canvas.toDataURL('image/png');

		// 清理资源
		offscreenRenderer.dispose();
		clonedAssembly.traverse((child) => {
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach(mat => mat.dispose());
    } else {
					child.material.dispose();
				}
			}
		});

		resolve(dataURL);
	});
}

// 生成UUID
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

// 显示提示消息
function showToast(message) {
	// 创建提示元素
	const toast = document.createElement('div');
	toast.textContent = message;
	toast.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: 12px 20px;
		border-radius: 8px;
		font-family: Arial, sans-serif;
		font-size: 14px;
		z-index: 1001;
		animation: toastSlideIn 0.3s ease-out;
	`;

	// 添加动画样式
	if (!document.querySelector('#toast-styles')) {
		const style = document.createElement('style');
		style.id = 'toast-styles';
		style.textContent = `
			@keyframes toastSlideIn {
				from { transform: translateX(100%); opacity: 0; }
				to { transform: translateX(0); opacity: 1; }
			}
		`;
		document.head.appendChild(style);
	}

	document.body.appendChild(toast);

	// 2秒后自动移除
    setTimeout(() => {
		toast.style.animation = 'toastSlideIn 0.3s ease-in reverse';
		setTimeout(() => {
			if (toast.parentNode) {
				toast.parentNode.removeChild(toast);
			}
		}, 300);
	}, 2000);
}

// 清空所有捕获
function clearAllCaptures() {
	console.log('clearAllCaptures called, capturedBirds:', capturedBirds);

	// 确保capturedBirds存在
	if (typeof capturedBirds !== 'undefined' && Array.isArray(capturedBirds)) {
		const count = capturedBirds.length;
	capturedBirds.length = 0; // 清空数组
	updateFilmRollUI(0); // 更新胶卷UI显示0
		console.log(`所有捕获的鸟类组合体已清空，共清空了 ${count} 个项目`);
	showToast('Film roll cleared');
	} else {
		console.error('capturedBirds is not defined or not an array:', capturedBirds);
		showToast('Error: Film roll data not available');
	}
}

// 将函数挂载到全局作用域，以便在HTML中调用
window.clearAllCaptures = clearAllCaptures;

// 打开胶卷画廊
function openGallery() {
	if (capturedBirds.length === 0) {
		showToast('No captured bird assemblies yet');
		return;
	}

	// 创建模态画廊
	createGalleryModal();
}

// 创建画廊模态框
function createGalleryModal() {
	// 移除现有的模态框
	const existingModal = document.querySelector('.gallery-modal');
	if (existingModal) {
		document.body.removeChild(existingModal);
	}

	// 创建模态框
	const modal = document.createElement('div');
	modal.className = 'gallery-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.8);
		z-index: 2000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	`;

	// 创建关闭按钮
	const closeButton = document.createElement('button');
	closeButton.textContent = '✕';
	closeButton.style.cssText = `
		position: absolute;
		top: 20px;
		right: 20px;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		border: none;
		font-size: 24px;
		cursor: pointer;
		padding: 10px 15px;
		border-radius: 50%;
	`;
	closeButton.onclick = () => document.body.removeChild(modal);
	modal.appendChild(closeButton);

	// 创建标题
	const title = document.createElement('h2');
	title.textContent = 'Captured Bird Assemblies';
	title.style.cssText = `
		color: white;
		margin-bottom: 20px;
		font-family: Arial, sans-serif;
	`;
	modal.appendChild(title);

	// 组装模式按钮
	const assembleButton = document.createElement('button');
	assembleButton.textContent = 'Enter Assembly Mode';
	assembleButton.style.cssText = `
		position: relative;
		margin-bottom: 10px;
		padding: 8px 12px;
	`;
	assembleButton.onclick = () => {
		document.body.removeChild(modal);
		createAssemblyModal();
	};
	modal.appendChild(assembleButton);

	// 创建缩略图容器
	const thumbnailContainer = document.createElement('div');
	thumbnailContainer.style.cssText = `
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		max-width: 800px;
		gap: 10px;
		margin-bottom: 20px;
	`;

	// 创建预览容器
	const previewContainer = document.createElement('div');
	previewContainer.style.cssText = `
		width: 400px;
		height: 400px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 18px;
		margin-bottom: 20px;
	`;
	previewContainer.textContent = 'Click thumbnails below to view large images';

	// 添加缩略图
	capturedBirds.forEach((capture, index) => {
		const thumbnail = document.createElement('img');
		thumbnail.src = capture.thumbnail;
		thumbnail.style.cssText = `
			width: 80px;
			height: 80px;
			object-fit: cover;
			border-radius: 4px;
			cursor: pointer;
			border: 2px solid transparent;
			transition: border-color 0.3s ease;
		`;
		thumbnail.onclick = () => showPreview(capture, previewContainer);
		thumbnail.onmouseenter = () => thumbnail.style.borderColor = '#4CAF50';
		thumbnail.onmouseleave = () => thumbnail.style.borderColor = 'transparent';

		thumbnailContainer.appendChild(thumbnail);
	});

	modal.appendChild(previewContainer);
	modal.appendChild(thumbnailContainer);
	document.body.appendChild(modal);
}

// 点击胶卷后显示所有捕获部件的超级组合体
async function displayCapturedAssemblies() {
	if (capturedBirds.length === 0) {
		showToast('No captured items in film roll');
		return;
	}

	console.log('准备展示所有捕获部件的超级组合体');

	// 创建展示模态框 - 显示超级组合体
	createSuperAssemblyModal();
}

// 创建超级组合体的展示模态框
function createSuperAssemblyModal() {
	// 移除现有的模态框
	const existingModal = document.querySelector('.super-assembly-modal');
	if (existingModal) {
		document.body.removeChild(existingModal);
	}

	// 创建模态框
	const modal = document.createElement('div');
	modal.className = 'super-assembly-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.95);
		z-index: 3000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 20px;
		box-sizing: border-box;
	`;

	// 创建关闭按钮
	const closeButton = document.createElement('button');
	closeButton.textContent = '✕';
	closeButton.style.cssText = `
		position: absolute;
		top: 20px;
		right: 20px;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		border: none;
		font-size: 24px;
		cursor: pointer;
		padding: 10px 15px;
		border-radius: 50%;
		z-index: 3001;
	`;
	closeButton.onclick = () => {
		// 清理超级组合体预览
		cleanupSuperAssemblyPreview();
		document.body.removeChild(modal);
	};
	modal.appendChild(closeButton);

	// 创建标题和控制栏
	const headerDiv = document.createElement('div');
	headerDiv.style.cssText = `
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 15px 20px;
		background: rgba(0, 0, 0, 0.3);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px 12px 0 0;
		box-sizing: border-box;
	`;

	const title = document.createElement('h2');
	const totalComponents = capturedBirds.reduce((sum, capture) => sum + capture.components.length, 0);
	title.textContent = `Super Bird Assembly (${capturedBirds.length} captures, ${totalComponents} components)`;
	title.style.cssText = `
		color: white;
		margin: 0;
		font-family: Arial, sans-serif;
		font-size: 16px;
		font-weight: normal;
	`;

	// 创建清空按钮
	const clearButton = document.createElement('button');
	clearButton.textContent = 'Clear Film';
	clearButton.style.cssText = `
		position: absolute;
		top: 20px;
		right: 100px;
		background: transparent;
		color: #ff6b6b;
		border: 1px solid #ff6b6b;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
		font-family: Arial, sans-serif;
		transition: all 0.3s ease;
		z-index: 3002;
	`;
	clearButton.onmouseover = () => {
		clearButton.style.background = '#ff6b6b';
		clearButton.style.color = 'white';
	};
	clearButton.onmouseout = () => {
		clearButton.style.background = 'transparent';
		clearButton.style.color = '#ff6b6b';
	};
	clearButton.onclick = () => {
			clearAllCaptures();
			cleanupSuperAssemblyPreview();
			document.body.removeChild(modal);
	};

	headerDiv.appendChild(title);
	// 将clearButton添加到modal而不是headerDiv，确保在最顶层
	modal.appendChild(clearButton);

	// 创建大预览容器 (占网页面的90%)
	const previewContainer = document.createElement('div');
	const containerWidth = window.innerWidth * 0.9;
	const containerHeight = window.innerHeight * 0.9;
	previewContainer.style.cssText = `
		width: ${containerWidth}px;
		height: ${containerHeight}px;
		background: rgba(42, 42, 42, 0.9);
		border-radius: 12px;
		position: relative;
		overflow: hidden;
		border: 2px solid rgba(255, 255, 255, 0.1);
		margin: 0 auto;
	`;

	// 显示加载状态
	const loadingDiv = document.createElement('div');
	loadingDiv.textContent = 'Assembling Super Bird...';
	// 将标题栏添加到预览容器顶部
	previewContainer.appendChild(headerDiv);

	loadingDiv.style.cssText = `
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		font-size: 18px;
		text-align: center;
		z-index: 3002;
	`;
	previewContainer.appendChild(loadingDiv);

	modal.appendChild(previewContainer);
	document.body.appendChild(modal);

	// 异步创建超级组合体
	createSuperAssembly(previewContainer, loadingDiv);
}

// 重建所有捕获的鸟类组合体
// 创建超级组合体（包含所有捕获的部件）
async function createSuperAssembly(container, loadingDiv) {
	try {
		console.log('开始创建超级组合体...');

		// 收集所有捕获项中的组件，按类型分组
		const allComponents = {
			chest: [],
			head: [],
			belly: [],
			wing: [],
			tail: [],
			foot: []
		};

		// 收集所有组件
		for (const capture of capturedBirds) {
			for (const component of capture.components) {
				if (allComponents[component.partType]) {
					allComponents[component.partType].push(component);
				}
			}
		}

		console.log('收集到的组件:', allComponents);

		// 创建超级组合体
		const superAssembly = new THREE.Group();
		superAssembly.name = 'SuperAssembly';

		// 为每种类型的组件创建布局
		await loadAndPlaceComponents(superAssembly, allComponents);

		// 移除加载提示
		if (loadingDiv.parentNode) {
			loadingDiv.parentNode.removeChild(loadingDiv);
		}

		// 保存组件列表用于whitebox.html预览
		const previewData = {
			id: `preview_${Date.now()}`,
			createdAt: Date.now(),
			components: []
		};

		// 收集所有组件信息
		superAssembly.traverse((child) => {
			if (child.userData && child.userData.partType && child.userData.fileName) {
				previewData.components.push({
					partType: child.userData.partType,
					fileName: child.userData.fileName,
					filePath: child.userData.filePath || `./models/bird_components/${child.userData.partType}/${child.userData.fileName}`,
					position: child.position.toArray(),
					rotation: child.rotation.toArray(),
					scale: child.scale.toArray()
				});
			}
		});

		// 保存到localStorage
		localStorage.setItem('superAssemblyPreview', JSON.stringify(previewData));
		console.log('保存超级组合体预览数据:', previewData);

		// 在新标签页中打开whitebox.html
		window.open('/whitebox.html', '_blank');

		// 显示完成信息
		container.innerHTML = `
			<div style="text-align: center; padding: 20px;">
				<h3 style="color: #4ecdc4; margin-bottom: 15px;">Super Assembly Created!</h3>
				<p style="color: #ddd; margin-bottom: 20px;">
					${superAssembly.children.length} components assembled<br>
					Preview opened in new tab
				</p>
				<button onclick="this.closest('.super-assembly-modal').style.display='none'"
						style="background: #4ecdc4; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-bottom: 10px;">
					Close
				</button>
				<br>
				<button onclick="clearAllCaptures(); this.closest('.super-assembly-modal').style.display='none';"
						style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
					Clear Film
				</button>
			</div>
		`;

		console.log('超级组合体创建完成，包含', superAssembly.children.length, '个部件');

	} catch (error) {
		console.error('创建超级组合体失败:', error);
		showToast('Super assembly creation failed');

		// 显示错误信息
		loadingDiv.textContent = 'Creation failed, please try again';
		loadingDiv.style.color = '#ff6b6b';
	}
}

// 加载并放置所有组件到超级组合体
async function loadAndPlaceComponents(superAssembly, componentsByType) {
	const loadPromises = [];

	// 为每种类型创建布局配置
	const layouts = {
		chest: { baseY: 0, spacing: 1.5, rowSize: 3 },
		head: { baseY: 2, spacing: 1.2, rowSize: 4 },
		belly: { baseY: -1.5, spacing: 1.2, rowSize: 4 },
		wing: { baseY: 0.5, spacing: 1.0, rowSize: 6 },
		tail: { baseY: -2.5, spacing: 1.0, rowSize: 4 },
		foot: { baseY: -3.5, spacing: 0.8, rowSize: 6 }
	};

	for (const [partType, components] of Object.entries(componentsByType)) {
		if (components.length === 0) continue;

		const layout = layouts[partType];
		let index = 0;

		for (const component of components) {
			loadPromises.push(
				loadComponentAndPlace(component, partType, layout, index, superAssembly)
			);
			index++;
		}
	}

	await Promise.all(loadPromises);
}

// 加载单个组件并放置到正确位置
async function loadComponentAndPlace(component, partType, layout, index, superAssembly) {
	try {
		console.log('加载组件:', component.filePath);

		// 加载组件
		const gltf = await new Promise((resolve, reject) => {
			const loader = createGLTFLoader();
			loader.load(
				component.filePath,
				resolve,
				null,
				reject
			);
		});

		const model = gltf.scene;

		// 应用材质预处理 - 超级组合体组件确保完全不透明，无淡入淡出
		model.traverse((child) => {
			if (child.isMesh && child.material) {
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				const newMaterials = [];

				materials.forEach(material => {
					try {
						if (!(material instanceof THREE.MeshStandardMaterial)) {
							const newMaterial = new THREE.MeshStandardMaterial();

							if (material.color && material.color.isColor) {
								newMaterial.color.copy(material.color);
							} else {
								newMaterial.color.setHex(0x888888);
							}

							if (material.map) newMaterial.map = material.map;
							if (material.normalMap) newMaterial.normalMap = material.normalMap;
							if (material.roughnessMap) newMaterial.roughnessMap = material.roughnessMap;
							if (material.metalnessMap) newMaterial.metalnessMap = material.metalnessMap;
							if (material.emissiveMap) newMaterial.emissiveMap = material.emissiveMap;

							if (typeof material.roughness === 'number') newMaterial.roughness = material.roughness;
							if (typeof material.metalness === 'number') newMaterial.metalness = material.metalness;
							if (typeof material.emissiveIntensity === 'number') newMaterial.emissiveIntensity = material.emissiveIntensity;

							newMaterial.roughness = 0.2; // 稍微增加粗糙度
							newMaterial.metalness = 0.6; // 降低金属度以增加亮度
							// 超级组合体组件：强制完全不透明，无淡入淡出
							newMaterial.transparent = false;
							newMaterial.opacity = 1.0;
							newMaterial.side = material.side || THREE.FrontSide;

							delete newMaterial.onBuild;
							delete newMaterial.onBeforeCompile;

							newMaterials.push(newMaterial);
						} else {
							delete material.onBuild;
							delete material.onBeforeCompile;
							// 超级组合体组件：强制完全不透明，无淡入淡出
							material.transparent = false;
							material.opacity = 1.0;
							newMaterials.push(material);
						}
					} catch (propError) {
						console.warn(`处理材质属性失败，使用默认值:`, propError);
						const defaultMaterial = new THREE.MeshStandardMaterial({
							color: 0x888888,
							transparent: false,
							opacity: 1.0
						});
						newMaterials.push(defaultMaterial);
					}
				});

				child.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;
			}
		});

		// 计算位置（网格布局）
		const row = Math.floor(index / layout.rowSize);
		const col = index % layout.rowSize;
		const offsetX = (col - (layout.rowSize - 1) / 2) * layout.spacing;
		const offsetZ = row * layout.spacing;

		model.position.set(offsetX, layout.baseY, offsetZ);
		model.userData.partType = partType;
		model.userData.fileName = component.filePath.split('/').pop();

		// 设置阴影
		model.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = false;
				child.receiveShadow = false;
			}
		});

		superAssembly.add(model);
		console.log(`放置 ${partType} 组件 #${index} 在位置 (${offsetX.toFixed(2)}, ${layout.baseY}, ${offsetZ.toFixed(2)})`);

	} catch (error) {
		console.warn('加载组件失败:', component.filePath, error);
	}
}

// 创建单个鸟类组合体的预览
function createAssemblyPreview(container, assembly) {
	// 创建临时的Three.js场景
	const tempScene = new THREE.Scene();
	tempScene.background = new THREE.Color(0x2a2a2a);

	const tempCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
	tempCamera.position.set(4, 2, 4);
	tempCamera.lookAt(0, 0, 0);

	const tempRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
	tempRenderer.setSize(200, 200);
	tempRenderer.setClearColor(0x2a2a2a, 1);

	// 添加更好的照明
	const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
	tempScene.add(ambientLight);

	const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
	directionalLight.position.set(5, 5, 5);
	tempScene.add(directionalLight);

	const fillLight = new THREE.DirectionalLight(0x87CEEB, 0.3);
	fillLight.position.set(-3, 2, -3);
	tempScene.add(fillLight);

	// 克隆完整的鸟类组合体
	const previewAssembly = assembly.clone();
	previewAssembly.position.set(0, 0, 0);
	previewAssembly.scale.set(0.6, 0.6, 0.6); // 稍微调大一点

	// 确保所有网格都可见并设置材质
	previewAssembly.traverse((child) => {
		if (child.isMesh) {
			child.castShadow = false;
			child.receiveShadow = false;
			child.visible = true;

			// 确保材质正确
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach(mat => {
						mat.transparent = false;
						mat.opacity = 1.0;
					});
				} else {
					child.material.transparent = false;
					child.material.opacity = 1.0;
				}
			}
		}
	});

	tempScene.add(previewAssembly);

	// 添加到容器
	container.appendChild(tempRenderer.domElement);

	// 调试信息
	console.log('预览组合体包含', previewAssembly.children.length, '个子对象');
	previewAssembly.children.forEach((child, index) => {
		console.log(`子对象 ${index}:`, child.name, '位置:', child.position);
	});

	// 动画循环
	let animationId;
	function animate() {
		animationId = requestAnimationFrame(animate);
		tempRenderer.render(tempScene, tempCamera);

		// 缓慢旋转展示
		previewAssembly.rotation.y += 0.005;
	}
	animate();

	// 存储引用以便清理
	container.tempRenderer = tempRenderer;
	container.tempScene = tempScene;
	container.animationId = animationId;
}

// 创建音量控制UI
function createVolumeControlUI() {
	const volumeControl = document.createElement('div');
	volumeControl.id = 'volume-control-ui';
	volumeControl.style.cssText = `
		position: fixed;
		bottom: 130px; /* 在胶卷上方 */
		right: 20px;
		width: 40px;
		height: 120px;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	`;

	// 创建SVG容器
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', '40');
	svg.setAttribute('height', '80');
	svg.setAttribute('viewBox', '0 0 40 80');
	svg.style.cssText = 'cursor: pointer;';

	// 绘制音量条背景
	const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	bgRect.setAttribute('x', '15');
	bgRect.setAttribute('y', '10');
	bgRect.setAttribute('width', '10');
	bgRect.setAttribute('height', '60');
	bgRect.setAttribute('fill', 'rgba(0, 0, 0, 0.6)');
	bgRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
	bgRect.setAttribute('stroke-width', '1');
	svg.appendChild(bgRect);

	// 绘制音量条填充
	const volumeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	volumeRect.setAttribute('x', '16');
	volumeRect.setAttribute('y', '11');
	volumeRect.setAttribute('width', '8');
	volumeRect.setAttribute('height', '48'); // 80% 高度
	volumeRect.setAttribute('fill', 'rgba(100, 200, 255, 0.8)');
	svg.appendChild(volumeRect);

	volumeControl.appendChild(svg);

	// 创建静音按钮
	const muteButton = document.createElement('button');
	muteButton.textContent = '🔊';
	muteButton.style.cssText = `
		width: 30px;
		height: 30px;
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		cursor: pointer;
		font-size: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	`;
	muteButton.title = 'Mute/Unmute';
	volumeControl.appendChild(muteButton);

	// 音量控制逻辑
	let isMuted = false;
	let previousVolume = 0.8;

	// 点击音量条调整音量
	svg.addEventListener('click', (e) => {
		const rect = svg.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const height = rect.height;
		const volume = Math.max(0, Math.min(1, 1 - (y - 10) / 60)); // 基于条的高度计算

		if (backgroundMusic) {
			backgroundMusic.volume = volume;
			updateVolumeDisplay(volume);
		}
	});

	// 更新静音按钮显示
	function updateMuteButtonDisplay(volume) {
		if (volume > 0) {
			muteButton.textContent = '🔊';
			muteButton.title = 'Mute';
		} else {
			muteButton.textContent = '🔇';
			muteButton.title = 'Unmute';
		}
	}

	// 静音按钮
	muteButton.addEventListener('click', () => {
		const backgroundMusic = document.getElementById('backgroundMusic');
		if (!backgroundMusic) return;

		if (backgroundMusic.volume > 0) {
			// 当前有声，点击后静音
			previousVolume = backgroundMusic.volume;
			backgroundMusic.volume = 0;
		} else {
			// 当前静音，点击后恢复音量
			backgroundMusic.volume = previousVolume > 0 ? previousVolume : 0.8;
		}
		updateVolumeDisplay(backgroundMusic.volume);
		updateMuteButtonDisplay(backgroundMusic.volume);
	});

	// 更新音量显示
	function updateVolumeDisplay(volume) {
		const height = Math.max(0, Math.min(60, volume * 60));
		volumeRect.setAttribute('height', height.toString());
		volumeRect.setAttribute('y', (71 - height).toString()); // 从底部向上填充

		// 更新颜色（低音量时变红）
		if (volume < 0.3) {
			volumeRect.setAttribute('fill', 'rgba(255, 100, 100, 0.8)');
		} else {
			volumeRect.setAttribute('fill', 'rgba(100, 200, 255, 0.8)');
		}

		// 更新静音按钮显示
		updateMuteButtonDisplay(volume);
	}

	// 初始化显示
	updateVolumeDisplay(0.8);

	document.body.appendChild(volumeControl);
}

// 创建超级组合体的预览
function createSuperAssemblyPreview(container, superAssembly) {
	// 获取容器实际尺寸
	const containerWidth = container.offsetWidth;
	const containerHeight = container.offsetHeight;

	// 创建临时的Three.js场景
	const tempScene = new THREE.Scene();

	// 设置摄像机 - 使用super-bird-demo的设置
	const aspectRatio = containerWidth / containerHeight;
	const tempCamera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 100);
	tempCamera.position.set(5.40, -0.09, 11.61); // super-bird-demo的相机位置
	tempCamera.lookAt(0, 0, 0);

	const tempRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
	tempRenderer.setSize(containerWidth, containerHeight);
	tempRenderer.outputColorSpace = THREE.SRGBColorSpace;
	tempRenderer.toneMapping = THREE.ACESFilmicToneMapping;
	tempRenderer.toneMappingExposure = 1.0; // 基础曝光，后期处理控制最终曝光
	tempRenderer.shadowMap.enabled = true;
	tempRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

	// 创建渲染目标用于后期处理
	const tempRenderTarget = new THREE.WebGLRenderTarget(containerWidth, containerHeight, {
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		encoding: THREE.sRGBEncoding
	});

	// 创建后期处理材质（使用super-bird-demo的设置）
	const tempPostProcessingShader = {
		uniforms: {
			tDiffuse: { value: null },
			brightness: { value: 0.12 },
			contrast: { value: 0.95 },
			saturation: { value: 1.05 },
			exposure: { value: 0.85 },
			colorBalance: { value: new THREE.Vector3(1.05, 1.0, 0.95) } // RGB色彩平衡
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform sampler2D tDiffuse;
			uniform float brightness;
			uniform float contrast;
			uniform float saturation;
			uniform float exposure;
			uniform vec3 colorBalance;
			varying vec2 vUv;

			void main() {
				vec4 color = texture2D(tDiffuse, vUv);

				// 曝光调整
				color.rgb *= exposure;

				// 色彩平衡调整（中和偏蓝色调）
				color.r *= colorBalance.r;
				color.g *= colorBalance.g;
				color.b *= colorBalance.b;

				// 亮度调整
				color.rgb += brightness;

				// 对比度调整
				color.rgb = (color.rgb - 0.5) * contrast + 0.5;

				// 饱和度调整
				float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
				color.rgb = mix(vec3(luminance), color.rgb, saturation);

				gl_FragColor = color;
			}
		`
	};

	const tempPostProcessingMaterial = new THREE.ShaderMaterial(tempPostProcessingShader);

	// 创建全屏四边形用于后期处理
	const tempGeometry = new THREE.PlaneGeometry(2, 2);
	const tempMesh = new THREE.Mesh(tempGeometry, tempPostProcessingMaterial);
	const tempScenePostProcessing = new THREE.Scene();
	tempScenePostProcessing.add(tempMesh);
	const tempPostProcessingCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	// 加载HDR背景和环境照明
	const hdrLoader = new HDRLoader();
	hdrLoader.load('/hdr/whitebox.hdr', (hdrTexture) => {
		hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

		// 设置为背景
		tempScene.background = hdrTexture;

		// 创建PMREM环境贴图用于材质照明
		const pmremGenerator = new THREE.PMREMGenerator(tempRenderer);
		pmremGenerator.compileEquirectangularShader();
		const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
		tempScene.environment = envMap;
		tempScene.environmentIntensity = 2.0; // 增强环境照明强度

		// 存储引用以便清理
		tempScene.hdrTexture = hdrTexture;
		tempScene.envMap = envMap;
		tempScene.pmremGenerator = pmremGenerator;

		console.log('HDR background and environment loaded');

		// HDR加载完成后，创建和添加超级组合体预览
		createAndAddPreviewAssembly();
	}, (progress) => {
		console.log('HDR loading progress:', progress);
	}, (error) => {
		console.warn('HDR loading failed:', error);
		// 即使HDR失败，也要创建预览（使用光照）
		createAndAddPreviewAssembly();

		// 尝试使用PNG文件作为回退
		const textureLoader = new THREE.TextureLoader();
		textureLoader.load('/hdr/whitebox.png', (texture) => {
			texture.mapping = THREE.EquirectangularReflectionMapping;
			tempScene.background = texture;
			console.log('Fallback PNG background loaded');
		}, undefined, (pngError) => {
			console.warn('PNG fallback also failed:', pngError);
			// 最终回退到默认背景
			tempScene.background = new THREE.Color(0x333333);
		});
	});

	// 使用super-bird-demo的光照系统 - 室内白炽灯暖色调
	// 环境光 - 室内白炽灯暖色调
	const ambientLight = new THREE.AmbientLight(0xFFF4E5, 2.0);
	tempScene.add(ambientLight);

	// 主关键光 - 室内白炽灯暖色调
	const keyLight = new THREE.DirectionalLight(0xFFF4E5, 2.0);
	keyLight.position.set(5, 10, 5);
	keyLight.castShadow = true;
	keyLight.shadow.mapSize.set(2048, 2048);
	keyLight.shadow.radius = 4;
	keyLight.shadow.camera.near = 0.1;
	keyLight.shadow.camera.far = 50;
	keyLight.shadow.camera.left = -15;
	keyLight.shadow.camera.right = 15;
	keyLight.shadow.camera.top = 15;
	keyLight.shadow.camera.bottom = -15;
	tempScene.add(keyLight);

	// 填充光 - 室内白炽灯暖色调
	const fillLight = new THREE.HemisphereLight(0xFFF4E5, 0xD4B08A, 1.0);
	tempScene.add(fillLight);

	// 聚光灯 - 室内白炽灯暖色调
	const spotLight = new THREE.SpotLight(0xFFF4E5, 20.0);
	spotLight.position.set(0, 8, 0);
	spotLight.target.position.set(0, 0, 0);
	spotLight.angle = Math.PI / 8;
	spotLight.penumbra = 0.1;
	spotLight.decay = 2;
	spotLight.distance = 20;
	spotLight.castShadow = true;
	spotLight.shadow.mapSize.width = 2048;
	spotLight.shadow.mapSize.height = 2048;
	spotLight.shadow.camera.near = 1;
	spotLight.shadow.camera.far = 20;
	spotLight.shadow.bias = -0.0001;
	tempScene.add(spotLight);
	tempScene.add(spotLight.target);

	// 创建和添加预览组合体的函数
	function createAndAddPreviewAssembly() {
	// 克隆并调整超级组合体
	const previewAssembly = superAssembly.clone();
	previewAssembly.position.set(0, 0, 0);
		previewAssembly.scale.set(1.25, 1.25, 1.25); // 稍微缩小以适应大预览框

		// 确保所有网格都可见并应用PBR材质设置
	previewAssembly.traverse((child) => {
		if (child.isMesh) {
			child.castShadow = true; // 启用阴影投射
			child.receiveShadow = true; // 启用阴影接收
			child.visible = true;

				// 确保材质是MeshStandardMaterial并设置PBR属性
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach((mat, index) => {
							// 如果不是MeshStandardMaterial，转换为MeshStandardMaterial并完整复制属性
							if (mat.type !== 'MeshStandardMaterial') {
								const standardMaterial = new THREE.MeshStandardMaterial();

								// 完整复制原有材质的所有属性
								Object.keys(mat).forEach(key => {
									if (key !== 'type' && key !== 'isMaterial' && typeof mat[key] !== 'function') {
										try {
											standardMaterial[key] = mat[key];
										} catch (e) {
											// 忽略无法复制的属性
										}
									}
							});

								// 应用PBR属性（如果原有材质没有设置）
								if (typeof standardMaterial.roughness !== 'number') {
									standardMaterial.roughness = 0.2;
								}
								if (typeof standardMaterial.metalness !== 'number') {
									standardMaterial.metalness = 0.6;
								}

								// 确保不透明
								standardMaterial.transparent = false;
								standardMaterial.opacity = 1.0;

								child.material[index] = standardMaterial;
						} else {
								// 已经是MeshStandardMaterial，确保PBR属性正确
								if (typeof mat.roughness !== 'number') {
									mat.roughness = 0.2;
								}
								if (typeof mat.metalness !== 'number') {
									mat.metalness = 0.6;
								}
							mat.transparent = false;
							mat.opacity = 1.0;
						}
					});
				} else {
						// 如果不是MeshStandardMaterial，转换为MeshStandardMaterial并完整复制属性
						if (child.material.type !== 'MeshStandardMaterial') {
							const standardMaterial = new THREE.MeshStandardMaterial();

							// 完整复制原有材质的所有属性
							Object.keys(child.material).forEach(key => {
								if (key !== 'type' && key !== 'isMaterial' && typeof child.material[key] !== 'function') {
									try {
										standardMaterial[key] = child.material[key];
									} catch (e) {
										// 忽略无法复制的属性
									}
								}
						});

							// 应用PBR属性（如果原有材质没有设置）
							if (typeof standardMaterial.roughness !== 'number') {
								standardMaterial.roughness = 0.2;
							}
							if (typeof standardMaterial.metalness !== 'number') {
								standardMaterial.metalness = 0.6;
							}

							// 确保不透明
							standardMaterial.transparent = false;
							standardMaterial.opacity = 1.0;

							child.material = standardMaterial;
					} else {
							// 已经是MeshStandardMaterial，确保PBR属性正确
							if (typeof child.material.roughness !== 'number') {
								child.material.roughness = 0.2;
							}
							if (typeof child.material.metalness !== 'number') {
								child.material.metalness = 0.6;
							}
						child.material.transparent = false;
						child.material.opacity = 1.0;
					}
				}
    }
  }
});

	tempScene.add(previewAssembly);

		// 存储引用以便清理
		container.previewAssembly = previewAssembly;

		// 调试信息
		console.log('超级组合体预览包含', previewAssembly.children.length, '个部件');
		previewAssembly.children.forEach((child, index) => {
			console.log(`部件 ${index}: ${child.userData.partType || 'unknown'} at (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
		});
	}

	// 添加到容器
	container.appendChild(tempRenderer.domElement);

	// 创建交互控制器 (不显示坐标轴)
	const tempControls = new OrbitControls(tempCamera, tempRenderer.domElement);
	tempControls.enableDamping = true; // 启用阻尼效果
	tempControls.dampingFactor = 0.05;
	tempControls.enableZoom = true; // 启用缩放
	tempControls.enableRotate = true; // 启用旋转
	tempControls.enablePan = false; // 禁用平移，保持模型居中
	tempControls.minDistance = 3; // 最小缩放距离
	tempControls.maxDistance = 20; // 最大缩放距离
	tempControls.maxPolarAngle = Math.PI; // 允许完整360度旋转
	tempControls.target.set(0, 0, 0); // 设置相机看向目标
	tempControls.update();

	// 动画循环 - 支持交互控制和后期处理
	let animationId;
	function animate() {
		animationId = requestAnimationFrame(animate);
		tempControls.update(); // 更新控制器

		// 使用后期处理渲染（类似super-bird-demo）
		if (tempRenderTarget && tempPostProcessingMaterial) {
			// 第一遍渲染到纹理（应用tone mapping）
			tempRenderer.setRenderTarget(tempRenderTarget);
			tempRenderer.render(tempScene, tempCamera);

			// 第二遍渲染后期处理效果
			tempRenderer.setRenderTarget(null);
			tempPostProcessingMaterial.uniforms.tDiffuse.value = tempRenderTarget.texture;
			tempRenderer.render(tempScenePostProcessing, tempPostProcessingCamera);
		} else {
			// 如果后期处理未准备好，直接渲染
		tempRenderer.render(tempScene, tempCamera);
		}
	}
	animate();

	// 存储引用以便清理
	container.tempRenderer = tempRenderer;
	container.tempScene = tempScene;
	container.tempRenderTarget = tempRenderTarget;
	container.tempPostProcessingMaterial = tempPostProcessingMaterial;
	container.tempScenePostProcessing = tempScenePostProcessing;
	container.animationId = animationId;
	container.tempControls = tempControls;
}

// 清理超级组合体预览
function cleanupSuperAssemblyPreview() {
	const modal = document.querySelector('.super-assembly-modal');
	if (!modal) return;

	// 查找预览容器 (现在使用百分比尺寸)
	const previewContainer = modal.querySelector('[style*="background: rgba(42, 42, 42, 0.9)"]');
	if (previewContainer) {
		if (previewContainer.animationId) {
			cancelAnimationFrame(previewContainer.animationId);
		}
		if (previewContainer.tempControls) {
			previewContainer.tempControls.dispose();
		}
		if (previewContainer.tempRenderer) {
			previewContainer.tempRenderer.dispose();
		}
		if (previewContainer.tempRenderTarget) {
			previewContainer.tempRenderTarget.dispose();
		}
		if (previewContainer.tempPostProcessingMaterial) {
			previewContainer.tempPostProcessingMaterial.dispose();
		}
		if (previewContainer.tempScene) {
			// 清理HDR资源
			if (previewContainer.tempScene.hdrTexture) {
				previewContainer.tempScene.hdrTexture.dispose();
			}
			if (previewContainer.tempScene.envMap) {
				previewContainer.tempScene.envMap.dispose();
			}
			if (previewContainer.tempScene.pmremGenerator) {
				previewContainer.tempScene.pmremGenerator.dispose();
			}

			previewContainer.tempScene.traverse((child) => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach(mat => mat.dispose());
  } else {
						child.material.dispose();
					}
				}
			});
		}
	}
}

// 清理画廊中的所有预览对象
function cleanupGalleryPreviews() {
	const modal = document.querySelector('.assemblies-gallery-modal');
	if (!modal) return;

	// 清理所有预览容器的Three.js资源
	const previewContainers = modal.querySelectorAll('[style*="width: 200px"]');
	previewContainers.forEach(container => {
		if (container.animationId) {
			cancelAnimationFrame(container.animationId);
		}
		if (container.tempRenderer) {
			container.tempRenderer.dispose();
		}
		if (container.tempScene) {
			container.tempScene.traverse((child) => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach(mat => mat.dispose());
					} else {
						child.material.dispose();
					}
				}
			});
		}
	});
}

// 显示预览
function showPreview(capture, previewContainer) {
	// 清空预览容器
	previewContainer.innerHTML = '';

	// 如果已经有预览对象，先清理
	if (previewContainer.previewObject) {
		previewContainer.previewObject.traverse((child) => {
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach(mat => mat.dispose());
				} else {
					child.material.dispose();
				}
			}
		});
		previewContainer.previewObject = null;
	}

	// 重新构建鸟类组合体并显示在场景中心
	reconstructBirdAssembly(capture).then(previewObject => {
		if (!previewObject) {
			previewContainer.textContent = 'Unable to reconstruct assembly';
			return;
		}

		// 临时添加到场景中心显示
		previewObject.position.set(0, 0, 0);
		previewObject.scale.set(0.8, 0.8, 0.8); // 稍微缩小显示

		// 确保所有网格都可见
		previewObject.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
				child.visible = true;
			}
		});

		// 添加到场景
		scene.add(previewObject);
		previewContainer.previewObject = previewObject;

		// 创建小的3D预览文本
		const textDiv = document.createElement('div');
		textDiv.textContent = `捕获时间: ${new Date(capture.timestamp).toLocaleString()}`;
		textDiv.style.cssText = `
			position: absolute;
			bottom: 10px;
			left: 10px;
			color: white;
			font-size: 12px;
			background: rgba(0, 0, 0, 0.5);
			padding: 5px;
			border-radius: 4px;
		`;
		previewContainer.appendChild(textDiv);

		// 3秒后自动移除预览对象
		setTimeout(() => {
			if (previewContainer.previewObject) {
				scene.remove(previewContainer.previewObject);
				previewContainer.previewObject.traverse((child) => {
					if (child.geometry) child.geometry.dispose();
					if (child.material) {
						if (Array.isArray(child.material)) {
							child.material.forEach(mat => mat.dispose());
						} else {
							child.material.dispose();
						}
					}
				});
				previewContainer.previewObject = null;
			}
		}, 3000);
	});
}

// 创建组装模态框（按固定顺序逐步添加组件）
function createAssemblyModal() {
	// 移除现有的模态框
	const existing = document.querySelector('.assembly-modal');
	if (existing) document.body.removeChild(existing);

	// 初始化预览组装
	resetPreviewAssembly();

	const modal = document.createElement('div');
	modal.className = 'assembly-modal';
	modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0,0,0,0.85);
		z-index: 2100;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	`;

	const closeBtn = document.createElement('button');
	closeBtn.textContent = '✕';
	closeBtn.style.cssText = `
		position: absolute; top: 20px; right: 20px; font-size: 24px;
	`;
	closeBtn.onclick = () => {
		// 清理临时预览
		resetPreviewAssembly();
		document.body.removeChild(modal);
	};
	modal.appendChild(closeBtn);

	const title = document.createElement('h2');
	title.textContent = 'Assembly Mode (Order: Head-Chest-Belly-Tail-LeftWing-RightWing-LeftFoot-RightFoot)';
	title.style.color = 'white';
	modal.appendChild(title);

	// 预览区域
	const previewBox = document.createElement('div');
	previewBox.style.cssText = `
		width: 480px; height: 360px; background: rgba(255,255,255,0.03);
		border-radius: 6px; margin: 12px; position: relative; display:flex;
		align-items:center; justify-content:center;
	`;
	previewBox.textContent = 'Click thumbnails below to add components in order';
	modal.appendChild(previewBox);

	// 控制按钮
	const controlsDiv = document.createElement('div');
	controlsDiv.style.cssText = 'margin:8px;';
	const resetBtn = document.createElement('button');
	resetBtn.textContent = 'Reset';
	resetBtn.onclick = () => resetPreviewAssembly();
	resetBtn.style.marginRight = '8px';
	const finishBtn = document.createElement('button');
	finishBtn.textContent = 'Complete and Center Display';
	finishBtn.onclick = () => {
		finishAssembly();
		document.body.removeChild(modal);
	};
	controlsDiv.appendChild(resetBtn);
	controlsDiv.appendChild(finishBtn);
	modal.appendChild(controlsDiv);

	// 缩略图容器（来自胶卷的捕获项）
	const thumbsContainer = document.createElement('div');
	thumbsContainer.style.cssText = `
		width: 90%; max-width: 1000px; display: flex; flex-wrap: wrap; gap: 10px;
		justify-content: center; padding: 8px; overflow: auto; max-height: 220px;
	`;

	// 使用已捕获的胶卷项作为缩略图源（按时间顺序）
	capturedBirds.forEach((capture, idx) => {
		const thumb = document.createElement('div');
		thumb.style.cssText = `
			width: 84px; height: 84px; background: rgba(255,255,255,0.04);
			display:flex; align-items:center; justify-content:center; flex-direction:column;
			border-radius:4px; cursor:pointer; color:white; font-size:11px; text-align:center;
			overflow:hidden;
		`;
		// 使用capture.thumbnail（已生成）
		const img = document.createElement('img');
		img.src = capture.thumbnail;
		img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:4px;';
		thumb.appendChild(img);

		thumb.onclick = () => {
			// 将胶卷条目的模型用作下一个插槽，按固定顺序组装
			addCapturedToPreview(capture);
		};

		thumbsContainer.appendChild(thumb);
	});

	modal.appendChild(thumbsContainer);
	document.body.appendChild(modal);

	// 在预览区域每帧更新位置（保持中心可见）
	const previewInterval = setInterval(() => {
		// 如果有previewAssembly，确保它在场景并居中位置显示
		if (previewAssembly) {
			previewAssembly.position.set(0, 0.6, 0);
		}
	}, 200);
	// 清理interval在关闭时由closeBtn处理（modal移除时自动停止）
}

// 添加组件到预览组（按顺序）
function addComponentToPreview(componentData, targetPartType) {
	if (nextSlotIndex >= SLOT_ORDER.length) {
		showToast('All parts are filled');
		return;
	}

	// 克隆模型并设置标识
	const clone = componentData.model.clone();
	clone.traverse(child => {
		if (child.isMesh) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});
	clone.userData.partType = targetPartType;

	// 添加到预览组
	if (!previewAssembly) {
		previewAssembly = new THREE.Group();
		previewAssembly.name = 'PreviewAssembly';
		scene.add(previewAssembly);
	}
	previewAssembly.add(clone);
	previewComponents.push({ partType: targetPartType, model: clone });
	nextSlotIndex++;

	// 重新对齐所有组件（若有胸部则以胸部为基准）
	alignPreviewAssembly();
}

// 使用胶卷中的捕获项作为组件添加到预览（智能布局）
async function addCapturedToPreview(capture) {
	// 尝试从capture中找到首个组件的元信息
	const firstComp = (capture.components && capture.components.length > 0) ? capture.components[0] : null;

	if (!firstComp || !firstComp.partType) {
		showToast('Unable to determine component type');
		return;
	}

	const targetPart = firstComp.partType;

	let modelToUse = null;
	// 尝试在组件库中找到原始模型以保证一致性
	const candidates = birdComponentLibrary.getAllComponents(targetPart) || [];
	const matched = candidates.find(c => (c.fileName || '') === firstComp.fileName);
	if (matched) modelToUse = matched.model.clone();

	// 如果没有找到匹配模型，使用重建的组合体作为回退
	if (!modelToUse) {
		const reconstructed = await reconstructBirdAssembly(capture);
		if (reconstructed) {
			// 如果重建返回多个子模型，取第一个子对象作为代表
			modelToUse = reconstructed.children.length > 0 ? reconstructed.children[0].clone() : reconstructed.clone();
		}
	}

	if (!modelToUse) {
		showToast('Unable to build component from this capture');
		return;
	}

	// 克隆模型并设置阴影
	modelToUse.traverse(child => {
		if (child.isMesh) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});

	// 将所选模型标记为目标部位
	modelToUse.userData.partType = targetPart;

	// 添加到预览组
	if (!previewAssembly) {
		previewAssembly = new THREE.Group();
		previewAssembly.name = 'PreviewAssembly';
		scene.add(previewAssembly);
	}
	previewAssembly.add(modelToUse);

	// 添加到智能分组系统
	componentGroups[targetPart].push({
		model: modelToUse,
		index: componentGroups[targetPart].length,
		total: componentGroups[targetPart].length + 1
	});

	// 更新分组中的total计数
	componentGroups[targetPart].forEach((item, idx) => {
		item.total = componentGroups[targetPart].length;
		item.index = idx;
	});

	// 应用智能布局
	applySmartLayout(previewAssembly);

	showToast(`Added ${targetPart} component (${componentGroups[targetPart].length} total)`);
}

// 将预览组件按包围盒对齐（参照 createBirdFromComponents）
function alignPreviewAssembly() {
	if (!previewAssembly) return;

	let chestBox = null;
	let chestCenter = new THREE.Vector3();
	previewAssembly.traverse(child => {
		if (child.userData && child.userData.partType === 'chest') {
			chestBox = new THREE.Box3().setFromObject(child);
			chestCenter = chestBox.getCenter(new THREE.Vector3());
		}
	});

	previewAssembly.children.forEach(child => {
		const partType = child.userData.partType;
		const box = new THREE.Box3().setFromObject(child);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());

		let target = new THREE.Vector3();
		if (!chestBox) {
			// 没有胸部时，简单排列在中心附近
			switch (partType) {
				case 'head': target.set(0, 0.8, 0); break;
				case 'chest': target.set(0, 0, 0); break;
				case 'belly': target.set(0, -0.6, 0); break;
				case 'tail': target.set(0, -0.4, 0.6); break;
				case 'leftWing': target.set(-0.6, 0, 0); break;
				case 'rightWing': target.set(0.6, 0, 0); break;
				case 'leftFoot': target.set(-0.3, -0.9, 0.2); break;
				case 'rightFoot': target.set(0.3, -0.9, 0.2); break;
				default: target.set(0,0,0); break;
			}
		} else {
			// 以胸部为参考进行对齐（更精确）
			switch (partType) {
				case 'head':
					target.set(chestCenter.x, chestBox.max.y + size.y * 0.5 + 0.001 + window.debugParams.heightOffset, chestCenter.z);
					break;
				case 'belly':
					target.set(chestCenter.x, chestBox.min.y - size.y * 0.5 - 0.001 + window.debugParams.heightOffset, chestCenter.z);
					break;
				case 'leftWing':
					target.set(chestBox.min.x + size.x * 0.5 + 0.001, chestCenter.y, chestCenter.z);
					break;
				case 'rightWing':
					target.set(chestBox.max.x - size.x * 0.5 - 0.001, chestCenter.y, chestCenter.z);
					break;
				case 'tail':
					target.set(chestCenter.x, chestCenter.y - size.y * 0.2 + window.debugParams.heightOffset, chestBox.max.z + size.z * 0.5 + 0.001);
					break;
				case 'leftFoot':
					target.set(chestCenter.x - 0.3, chestBox.min.y - size.y * 0.5 - 0.001 + window.debugParams.heightOffset, chestCenter.z + 0.2);
					break;
				case 'rightFoot':
					target.set(chestCenter.x + 0.3, chestBox.min.y - size.y * 0.5 - 0.001 + window.debugParams.heightOffset, chestCenter.z + 0.2);
					break;
				case 'chest':
					target.copy(chestCenter);
					break;
				default:
					target.copy(chestCenter);
					break;
			}
		}

		// 将child中心移动到target
		const delta = target.clone().sub(center);
		child.position.add(delta);
	});
}

// ===== 智能布局系统 - 位置计算器 =====

// 获取基础位置（与alignPreviewAssembly保持一致）
function getBasePosition(partType) {
	const basePositions = {
		head: new THREE.Vector3(0, 1.5, 0),
		chest: new THREE.Vector3(0, 0, 0),
		belly: new THREE.Vector3(0, -1, 0),
		tail: new THREE.Vector3(0, -1.5, 1),
		leftWing: new THREE.Vector3(-2, 0.5, 0.2),
		rightWing: new THREE.Vector3(2, 0.5, 0.2),
		leftFoot: new THREE.Vector3(-0.8, -2, 0.5),
		rightFoot: new THREE.Vector3(0.8, -2, 0.5)
	};
	return basePositions[partType] || new THREE.Vector3(0, 0, 0);
}

// 分布策略：圆形随机分布
function calculateDistributedPosition(basePosition, index, total) {
	if (total === 1) return basePosition.clone();

	const params = window.previewLayoutParams;
	const angle = (index / total) * Math.PI * 2;
	const radius = params.distributedRadius * (0.7 + Math.random() * 0.6);

	return new THREE.Vector3(
		basePosition.x + Math.cos(angle) * radius,
		basePosition.y + (Math.random() - 0.5) * 0.1,
		basePosition.z + Math.sin(angle) * radius
	);
}

// 螺旋策略：螺旋上升堆叠
function calculateSpiralPosition(basePosition, index, total) {
	if (total === 1) return basePosition.clone();

	const params = window.previewLayoutParams;
	const t = index / Math.max(total - 1, 1);
	const angle = t * Math.PI * 2 * params.spiralTurns;
	const radius = 0.1 + t * params.spiralRadiusStep * total;
	const height = t * params.spiralHeightStep * total;

	return new THREE.Vector3(
		basePosition.x + Math.cos(angle) * radius,
		basePosition.y + height,
		basePosition.z + Math.sin(angle) * radius
	);
}

// 级联策略：重力瀑布流
function calculateCascadePosition(basePosition, index, total) {
	if (total === 1) return basePosition.clone();

	const params = window.previewLayoutParams;
	const cascadeOffset = index * params.cascadeGravity;
	const horizontalDrift = (Math.random() - 0.5) * params.cascadeSpread * index;
	const verticalVariation = (Math.random() - 0.5) * 0.08;

	return new THREE.Vector3(
		basePosition.x + horizontalDrift,
		basePosition.y - cascadeOffset + verticalVariation,
		basePosition.z + (Math.random() - 0.5) * params.cascadeSpread * 0.5
	);
}

// 对称堆叠策略：左右对称堆叠
function calculateSymmetricStackPosition(basePosition, index, total, isLeft = true) {
	if (total === 1) return basePosition.clone();

	const params = window.previewLayoutParams;
	const layer = Math.floor(index / 2);
	const isEven = index % 2 === 0;

	const sideMultiplier = isEven ? 1 : -1;
	const layerOffset = layer * params.symmetricSpacing;

	return new THREE.Vector3(
		basePosition.x + sideMultiplier * layerOffset,
		basePosition.y + layer * 0.05,
		basePosition.z + (Math.random() - 0.5) * 0.02
	);
}

// 获取最佳策略
function getBestStrategy(partType, count) {
	if (count === 1) return 'single';

	const mapping = {
		head: 'distributed',     // 头部使用分布
		chest: 'spiral',         // 胸部使用螺旋
		belly: 'spiral',         // 腹部使用螺旋
		tail: 'cascade',         // 尾部使用级联
		leftWing: 'spiral',      // 左翅膀使用螺旋
		rightWing: 'spiral',     // 右翅膀使用螺旋
		leftFoot: 'symmetric',   // 左足部使用对称堆叠
		rightFoot: 'symmetric'   // 右足部使用对称堆叠
	};

	return mapping[partType] || 'distributed';
}

// 计算位置（统一接口）
function calculatePosition(partType, index, total, strategy) {
	const basePosition = getBasePosition(partType);

	switch (strategy) {
		case 'distributed':
			return calculateDistributedPosition(basePosition, index, total);
		case 'spiral':
			return calculateSpiralPosition(basePosition, index, total);
		case 'cascade':
			return calculateCascadePosition(basePosition, index, total);
		case 'symmetric':
			const isLeft = partType.startsWith('left');
			return calculateSymmetricStackPosition(basePosition, index, total, isLeft);
		case 'single':
		default:
			return basePosition.clone();
	}
}

// 应用智能布局到预览组装
function applySmartLayout(previewAssembly) {
	if (!previewAssembly) return;

	Object.keys(componentGroups).forEach(partType => {
		const components = componentGroups[partType];
		if (components.length === 0) return;

		const strategy = getBestStrategy(partType, components.length);

		components.forEach((component, index) => {
			const position = calculatePosition(partType, index, components.length, strategy);
			component.model.position.copy(position);

			// 应用旋转（某些策略可能需要特定旋转）
			applyStrategyRotation(component.model, partType, strategy, index);
		});
	});
}

// 应用策略相关的旋转
function applyStrategyRotation(model, partType, strategy, index) {
	// 重置旋转
	model.rotation.set(0, 0, 0);

	switch (strategy) {
		case 'spiral':
			// 螺旋策略可以添加一些旋转变化
			if (partType.includes('Wing')) {
				model.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.3; // 轻微展开
			}
			break;
		case 'cascade':
			// 级联策略可以添加一些随机倾斜
			if (partType === 'tail') {
				model.rotation.x = 0.2 + (Math.random() - 0.5) * 0.1; // 向下倾斜
			}
			break;
		case 'symmetric':
			// 对称策略保持默认旋转
			break;
		case 'distributed':
			// 分布策略可以添加一些随机旋转
			model.rotation.y = (Math.random() - 0.5) * 0.5;
			break;
	}
}

// ===== 相机聚焦辅助函数 =====

function easeOutCubic(t) {
	return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t) {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ===== 鸟类透明度动画辅助函数 =====

function setObjectOpacity(object3D, opacity) {
	if (!object3D) return;

	object3D.traverse((child) => {
		if (child.isMesh && child.material) {
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			materials.forEach(material => {
				material.transparent = true;
				material.opacity = opacity;
				material.needsUpdate = true;
			});
		}
	});
}

function animateOpacity(object3D, from, to, duration, easing = easeInOut, onComplete = null) {
	if (!object3D) return null;

	const startTime = performance.now();
	let animationId = null;
	let cancelled = false;

	function animate(now) {
		if (cancelled) return;

		const elapsed = now - startTime;
		const t = Math.min(1, elapsed / duration);
		const easedT = easing(t);

		const currentOpacity = from + (to - from) * easedT;
		setObjectOpacity(object3D, currentOpacity);

		if (t < 1) {
			animationId = requestAnimationFrame(animate);
		} else {
			setObjectOpacity(object3D, to);
			if (onComplete) onComplete();
			animationId = null;
		}
	}

	animationId = requestAnimationFrame(animate);

	// 返回取消函数
	return () => {
		cancelled = true;
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
	};
}

function startCameraFocus(targetObject, duration) {
	if (!camera || !targetObject) return;

	// 取消已有聚焦
	if (cameraFocusState.active) {
		cancelCameraFocus(true);
	}

	cameraFocusState.active = true;
	cameraFocusState.startTime = performance.now();
	cameraFocusState.duration = duration || SELECTION_REQUIRED_TIME;
	cameraFocusState.original = {
		position: camera.position.clone(),
		quaternion: camera.quaternion.clone(),
		target: controls ? controls.target.clone() : new THREE.Vector3()
	};

	// 目标中心（包围盒中心）
	const box = new THREE.Box3().setFromObject(targetObject);
      const center = box.getCenter(new THREE.Vector3());
	cameraFocusState.targetCenter = center;

	// 目标位置：向对象靠近约30%
	const currentDistance = camera.position.distanceTo(center);
	const targetDistance = currentDistance * 0.7; // 靠近30%
	const dir = center.clone().sub(camera.position).normalize();
	cameraFocusState.startPos = camera.position.clone();
	cameraFocusState.targetPos = center.clone().sub(dir.multiplyScalar(targetDistance));
	cameraFocusState.startTarget = controls ? controls.target.clone() : new THREE.Vector3();

	// 禁用交互
	if (controls) controls.enabled = false;

	// 动画循环
	function animateFocus(now) {
		const elapsed = now - cameraFocusState.startTime;
		const t = Math.min(1, elapsed / cameraFocusState.duration);
		const e = easeOutCubic(t);

		// 插值位置
		camera.position.lerpVectors(cameraFocusState.startPos, cameraFocusState.targetPos, e);
		// 插值controls.target
		if (controls) {
			controls.target.lerpVectors(cameraFocusState.startTarget, cameraFocusState.targetCenter, e);
			controls.update();
      } else {
			camera.lookAt(cameraFocusState.targetCenter);
		}

		if (t < 1 && cameraFocusState.active) {
			cameraFocusState.animationId = requestAnimationFrame(animateFocus);
		} else {
			cameraFocusState.animationId = null;
		}
	}

	cameraFocusState.animationId = requestAnimationFrame(animateFocus);
}

function cancelCameraFocus(immediateRevert = false) {
	if (!cameraFocusState.active) return;

	const revertDuration = immediateRevert ? 200 : 400;
	const startPos = camera.position.clone();
	const startTarget = controls ? controls.target.clone() : new THREE.Vector3();
	const endPos = cameraFocusState.original.position.clone();
	const endTarget = cameraFocusState.original.target.clone();
	const startTime = performance.now();

	// 停止当前动画
	if (cameraFocusState.animationId) {
		cancelAnimationFrame(cameraFocusState.animationId);
		cameraFocusState.animationId = null;
	}

	function animateRevert(now) {
		const elapsed = now - startTime;
		const t = Math.min(1, elapsed / revertDuration);
		const e = easeOutCubic(t);

		camera.position.lerpVectors(startPos, endPos, e);
		if (controls) {
			controls.target.lerpVectors(startTarget, endTarget, e);
			controls.update();
		} else {
			camera.lookAt(endTarget);
		}

		if (t < 1) {
			cameraFocusState.animationId = requestAnimationFrame(animateRevert);
		} else {
			cameraFocusState.animationId = null;
			cameraFocusState.active = false;
			if (controls) controls.enabled = true;
		}
	}

	cameraFocusState.animationId = requestAnimationFrame(animateRevert);
}

function finalizeCameraFocus() {
	// 完成选择后，保持聚焦并重新启用交互
	if (!cameraFocusState.active) return;
	// 停止动画（如果仍在跑）
	if (cameraFocusState.animationId) {
		cancelAnimationFrame(cameraFocusState.animationId);
		cameraFocusState.animationId = null;
	}
	// 直接将相机置于目标位并恢复controls
	camera.position.copy(cameraFocusState.targetPos);
	if (controls) {
		controls.target.copy(cameraFocusState.targetCenter);
		controls.update();
		controls.enabled = true;
	} else {
		camera.lookAt(cameraFocusState.targetCenter);
	}

	cameraFocusState.active = false;
}

// 观察模式函数
function enterObservationMode(targetBird = null) {
	if (observationMode.active) return;

	// 如果没有指定目标鸟类，寻找最近的活动鸟类
	if (!targetBird) {
		const activeBirds = flyingBirds.filter(bird => bird && bird.alive && bird.mesh);
		if (activeBirds.length === 0) return;

		// 选择最近的鸟类
		let closestBird = null;
		let closestDistance = Infinity;

		activeBirds.forEach(bird => {
			const distance = camera.position.distanceTo(bird.mesh.position);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestBird = bird;
			}
		});

		targetBird = closestBird;
		if (!targetBird) return;
	}

	observationMode.active = true;
	observationMode.targetBird = targetBird;

	// 禁用OrbitControls
	if (controls) {
		controls.enabled = false;
	}

	console.log('🎯 进入观察模式，跟踪鸟类');
	showToast('进入观察模式 - 按Q或右键拖拽退出');
}

function exitObservationMode() {
	if (!observationMode.active) return;

	observationMode.active = false;
	observationMode.targetBird = null;

	// 重新启用OrbitControls
	if (controls) {
		controls.enabled = true;
	}

	console.log('👁️ 退出观察模式');
	showToast('退出观察模式');
}

function updateObservationMode() {
	if (!observationMode.active || !observationMode.targetBird) return;

	const bird = observationMode.targetBird;

	// 检查鸟类是否还活着
	if (!bird.alive || !bird.mesh) {
		// 自动切换到其他鸟类
		const activeBirds = flyingBirds.filter(b => b && b.alive && b.mesh && b !== bird);
		if (activeBirds.length > 0) {
			observationMode.targetBird = activeBirds[Math.floor(Math.random() * activeBirds.length)];
			console.log('🔄 自动切换到另一只鸟类');
			showToast('切换到下一只鸟类');
		} else {
			exitObservationMode();
			showToast('没有更多鸟类，退出观察模式');
			return;
		}
	}

	// 计算理想相机位置（鸟类后方偏上）
	const birdPosition = bird.mesh.position.clone();
	const birdDirection = bird.velocity.clone().normalize();

	// 如果鸟类静止，使用默认方向
	if (birdDirection.lengthSq() < 0.01) {
		birdDirection.set(0, 0, 1);
	}

	// 计算相机位置（鸟类后方followDistance距离，高度followHeight）
	const cameraOffset = birdDirection.clone().multiplyScalar(-observationMode.followDistance);
	cameraOffset.y += observationMode.followHeight;

	const targetCameraPos = birdPosition.clone().add(cameraOffset);

	// 平滑移动相机
	camera.position.lerp(targetCameraPos, observationMode.smoothFactor);

	// 让相机朝向鸟类
	const lookAtPos = birdPosition.clone();
	lookAtPos.y += 0.5; // 稍微向上看
	camera.lookAt(lookAtPos);

	// 更新OrbitControls的target（如果以后需要恢复）
	if (controls) {
		controls.target.copy(lookAtPos);
	}
}

// 重置预览组装
function resetPreviewAssembly() {
	// 清理场景中的预览组
	if (previewAssembly) {
		scene.remove(previewAssembly);
		previewAssembly.traverse(child => {
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
				else child.material.dispose();
			}
		});
		previewAssembly = null;
	}
	previewComponents = [];
	nextSlotIndex = 0;

	// 重置智能分组系统
	Object.keys(componentGroups).forEach(key => {
		componentGroups[key] = [];
	});
}

// 完成组装：将组装好的模型置中并保留在场景内
function finishAssembly() {
	if (!previewAssembly) {
		showToast('No assembly content currently');
		return;
	}
	// 将previewAssembly移动到场景中心并保持（不再自动移除）
	previewAssembly.position.set(0, 1.0, 0);
	previewAssembly.scale.set(0.8, 0.8, 0.8);
	previewAssembly.name = 'AssembledPreview';
	// 清理状态，允许再次组装新模型
	previewAssembly = null;
	previewComponents = [];
	nextSlotIndex = 0;
	showToast('Assembly completed, placed at scene center');
}

// 重建鸟类组合体 - 简化版：直接加载保存的文件
async function reconstructBirdAssembly(capture) {
	console.log('开始重建组合体，包含', capture.components ? capture.components.length : 0, '个组件');

	const assembly = new THREE.Group();
	assembly.name = 'PreviewAssembly';

	// 检查组件数据
	if (!capture.components || capture.components.length === 0) {
		console.error('捕获项没有组件数据');
		return null;
	}

	// 重新加载所有组件
	const loadPromises = capture.components.map(async (component) => {
		try {
			console.log('加载组件:', component.filePath);

			// 直接加载指定的文件
			const gltf = await new Promise((resolve, reject) => {
				const loader = createGLTFLoader();
				loader.load(
					component.filePath,
					resolve,
					null,
					reject
				);
			});

			const model = gltf.scene;

			// 应用材质预处理
			model.traverse((child) => {
				if (child.isMesh && child.material) {
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					const newMaterials = [];

					materials.forEach(material => {
						try {
							if (!(material instanceof THREE.MeshStandardMaterial)) {
								const newMaterial = new THREE.MeshStandardMaterial();

								if (material.color && material.color.isColor) {
									newMaterial.color.copy(material.color);
								} else {
									newMaterial.color.setHex(0x888888);
								}

								if (material.map) newMaterial.map = material.map;
								if (material.normalMap) newMaterial.normalMap = material.normalMap;
								if (material.roughnessMap) newMaterial.roughnessMap = material.roughnessMap;
								if (material.metalnessMap) newMaterial.metalnessMap = material.metalnessMap;
								if (material.emissiveMap) newMaterial.emissiveMap = material.emissiveMap;

								if (typeof material.roughness === 'number') newMaterial.roughness = material.roughness;
								if (typeof material.metalness === 'number') newMaterial.metalness = material.metalness;
								if (typeof material.emissiveIntensity === 'number') newMaterial.emissiveIntensity = material.emissiveIntensity;

								newMaterial.roughness = 0.1; // PBR属性：低粗糙度
								newMaterial.metalness = 0.9; // PBR属性：高金属度
								newMaterial.transparent = material.transparent || false;
								newMaterial.opacity = material.opacity !== undefined ? material.opacity : 1.0;
								newMaterial.side = material.side || THREE.FrontSide;

								delete newMaterial.onBuild;
								delete newMaterial.onBeforeCompile;

								newMaterials.push(newMaterial);
							} else {
								delete material.onBuild;
								delete material.onBeforeCompile;
								newMaterials.push(material);
							}
						} catch (propError) {
							console.warn(`处理材质属性失败，使用默认值:`, propError);
							newMaterials.push(new THREE.MeshStandardMaterial({ color: 0x888888 }));
						}
					});

					child.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;
				}
			});

			// 设置组件标识
			model.userData.partType = component.partType;
			model.userData.fileName = component.filePath.split('/').pop();

			// 设置阴影
			model.traverse((child) => {
				if (child.isMesh) {
					child.castShadow = true;
					child.receiveShadow = true;
				}
			});

			console.log('组件加载成功:', component.filePath);
			return model;

		} catch (error) {
			console.warn('加载组件失败:', component.filePath, error);
			return null;
		}
	});

	// 等待所有组件加载完成
	const loadedModels = await Promise.all(loadPromises);
	const validModels = loadedModels.filter(model => model !== null);

	if (validModels.length === 0) {
		console.error('没有成功加载任何组件');
		return null;
	}

	// 使用默认组装逻辑重新组装这些组件
	console.log('开始重新组装', validModels.length, '个组件');

	// 创建一个临时组件库，只包含已加载的模型
	const tempComponents = {};
	validModels.forEach((model, index) => {
		const partType = capture.components[index].partType;
		if (!tempComponents[partType]) {
			tempComponents[partType] = [];
		}
		tempComponents[partType].push({
			model: model,
			fileName: model.userData.fileName,
			id: `temp_${index}`
		});
	});

	// 使用简化版的组装逻辑
	const partTypes = ['chest', 'head', 'belly', 'wing', 'tail', 'foot'];
	const gap = 0.05;

	for (const partType of partTypes) {
		const components = tempComponents[partType];
		if (!components || components.length === 0) continue;

		components.forEach((component, index) => {
			const modelClone = component.model.clone();

			// 应用默认位置
			switch (partType) {
				case 'chest':
					// 胸部作为中心
					break;
				case 'head':
					modelClone.position.set(0, 1.5, 0);
					break;
				case 'belly':
					modelClone.position.set(0, -1, 0);
					break;
				case 'wing':
					const wingX = index % 2 === 0 ? -1.7 : 1.7;
					modelClone.position.set(wingX, 0.5, 0.2);
					modelClone.rotation.z = index % 2 === 0 ? 0.3 : -0.3;
					break;
				case 'tail':
					modelClone.position.set(0, -1.5, 1);
					modelClone.rotation.x = 0.2;
					break;
				case 'foot':
					const footX = index % 2 === 0 ? -0.5 : 0.5;
					modelClone.position.set(footX, -2, 0.5);
					break;
			}

			assembly.add(modelClone);
			console.log(`添加${partType}组件到组装体`);
		});
	}

	console.log('重建完成，组装体包含', assembly.children.length, '个组件');
	console.log('组装体子对象:');
	assembly.children.forEach((child, index) => {
		console.log(`  ${index}: ${child.userData.partType || 'unknown'} at (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
	});

	return assembly.children.length > 0 ? assembly : null;
}

// 鸟类性格模式
const BIRD_PERSONALITIES = {
	OBSERVER: 'observer',     // 观察者：主要悬停，偶尔巡逻
	PATROL: 'patrol',         // 巡逻者：主要巡逻，偶尔悬停
	TRAVELER: 'traveler',     // 旅行者：主要穿梭，偶尔悬停
	ACTIVE: 'active'          // 活跃者：组合所有行为，频繁切换
};

// 鸟类飞行数据结构
class FlyingBird {
	constructor(mesh, startTime, lifetime, personality, initialTree) {
		this.mesh = mesh;
		this.startTime = startTime;
		this.lifetime = lifetime;
		this.personality = personality; // 性格模式
		this.currentTree = initialTree; // 当前所在树木
		this.isAlive = true;

		// 设置鸟类标识，用于鼠标选择检测
		this.mesh.userData.isBird = true;

		// 物理状态（steering behavior所需）
		this.velocity = new THREE.Vector3();
		this.acceleration = new THREE.Vector3();

		// 按性格初始化运动参数
		this.initializeMovementParams();

		// 创建steering实例
		this.steering = createSteering(this);

		// 行为状态
		this.currentBehavior = 'hover'; // 当前行为：hover, patrol, travel
		this.behaviorStartTime = startTime;
		this.behaviorDuration = 3000 + Math.random() * 7000; // 3-10秒

		// 淡入淡出状态
		this.fadeInAnimation = null;
		this.fadeOutAnimation = null;
		this.isFadingOut = false; // 是否正在淡出

		// 初始化透明度为0，开始淡入
		setObjectOpacity(this.mesh, 0);
		this.fadeInAnimation = animateOpacity(this.mesh, 0, 1, BIRD_FADE_IN_MS, easeInOut);

		// 飞行路径相关
		this.flightPath = null;
		this.hoverPosition = null;
		this.targetTree = null;
		this.pathFollower = null; // 用于travel的路径跟随器

		// 设置初始位置在树木合理高度范围内
		this.setInitialPosition();

		// 初始化第一个行为
		this.chooseNextBehavior();
	}

	/**
	 * 按性格初始化运动参数
	 */
	initializeMovementParams() {
		// 基础参数（会被性格调整）
		let baseMaxSpeed = 5.0;
		let baseMaxForce = 0.02;

		// 按性格调整参数
		switch (this.personality) {
			case BIRD_PERSONALITIES.OBSERVER:
				// 观察者：较慢，较平稳
				baseMaxSpeed *= 0.7;
				baseMaxForce *= 0.8;
				break;
			case BIRD_PERSONALITIES.PATROL:
				// 巡逻者：中等速度，较有力量
				baseMaxSpeed *= 1.0;
				baseMaxForce *= 1.2;
				break;
			case BIRD_PERSONALITIES.TRAVELER:
				// 旅行者：较快，较有力量
				baseMaxSpeed *= 1.2;
				baseMaxForce *= 1.3;
				break;
			case BIRD_PERSONALITIES.ACTIVE:
				// 活跃者：最快，最有力量
				baseMaxSpeed *= 1.4;
				baseMaxForce *= 1.5;
				break;
		}

		// 添加随机性
		this.maxSpeed = baseMaxSpeed * (0.8 + Math.random() * 0.4);
		this.maxForce = baseMaxForce * (0.8 + Math.random() * 0.4);

		// 调试输出
		console.log(`鸟类 ${this.personality} 初始化: maxSpeed=${this.maxSpeed.toFixed(2)}, maxForce=${this.maxForce.toFixed(3)}`);
	}

	// 设置初始位置
	setInitialPosition() {
		const treePos = this.currentTree.position;
		const treeHeight = this.currentTree.height;
		const crownHeight = 8;
		const totalTreeHeight = treeHeight + crownHeight;

		// 初始位置应该在树木中上部
		const initialHeight = treeHeight * 0.3 + Math.random() * (totalTreeHeight * 0.1) + window.debugParams.heightOffset;

		const initialOffset = new THREE.Vector3(
			(Math.random() - 0.5) * 3, // X偏移 ±1.5
			initialHeight,             // Y位置基于树木高度
			(Math.random() - 0.5) * 3  // Z偏移 ±1.5
		);

		this.mesh.position.copy(treePos.clone().add(initialOffset));
	}
}

// 生成新的飞行鸟类
function generateFlyingBirds() {
	const currentTime = Date.now();
	if (currentTime - lastBirdGenerationTime < BIRD_GENERATION_INTERVAL) {
		return; // 还没到生成时间
	}

	// 检查当前活跃鸟类数量
	const activeBirds = flyingBirds.filter(bird => bird.isAlive);
	if (activeBirds.length >= MAX_FLYING_BIRDS) {
		return; // 已达到最大数量
	}

	// 决定生成数量（1-3只）
	const birdCount = Math.floor(Math.random() * 3) + 1;
	const birdsToGenerate = Math.min(birdCount, MAX_FLYING_BIRDS - activeBirds.length);

	console.log(`生成 ${birdsToGenerate} 只新的飞行鸟类`);

	for (let i = 0; i < birdsToGenerate; i++) {
		createFlyingBird();
	}

	lastBirdGenerationTime = currentTime;
}

// 创建单个飞行鸟类
function createFlyingBird() {
	// 从现有组件创建鸟类
	const birdMesh = createBirdFromComponents();
	if (!birdMesh) {
		console.warn('无法创建飞行鸟类');
		return;
	}

	// 随机选择树木作为飞行起点
	const treeIndex = Math.floor(Math.random() * treePositions.length);
	const treeData = treePositions[treeIndex];

	// 随机选择性格模式
	const personalities = Object.values(BIRD_PERSONALITIES);
	const personality = personalities[Math.floor(Math.random() * personalities.length)];

	// 设置鸟类初始大小
	birdMesh.scale.set(0.2, 0.2, 0.2); // 飞行鸟类更小

	// 创建飞行鸟类对象
	const flyingBird = new FlyingBird(
		birdMesh,
		Date.now(),
		30000 + BIRD_LIFETIME_BONUS_MS, // 30秒基础寿命 + 10秒淡出延长时间
		personality,
		treeData
	);

	// 添加到场景和鸟类列表
	forestGroup.add(birdMesh);
	flyingBirds.push(flyingBird);

	console.log(`飞行鸟类已创建，性格: ${personality}，位置: 树木${treeIndex}`);
}

// 从组件创建鸟类
function createBirdFromComponents() {
	// 检查组件库是否已加载
	if (!birdComponentLibrary.isLoaded()) {
		console.warn('组件库未加载，使用默认鸟类模型');
		// 回退到克隆现有birdGroup
		const birdMesh = birdGroup.clone();
		birdMesh.traverse((child) => {
			if (child.isMesh && child.material) {
				child.material = child.material.clone();
			}
		});
		return birdMesh;
	}

	// 创建新的鸟类组合
	const birdMesh = new THREE.Group();
	const components = [];

	// 按照组装规则随机选择组件
	// 规则：胸部(必须) → 头部 → 腹部 → 翅膀(对称) → 尾巴 → 足部(对称)

	// 1. 胸部（必须）
	const chestComponent = birdComponentLibrary.getRandomComponent('chest');
	if (chestComponent) {
		components.push({ component: chestComponent, partType: 'chest' });
		console.log('添加胸部组件:', chestComponent.fileName);
          } else {
		console.warn('没有找到胸部组件！');
		return null;
	}

	// 2. 头部（可选）
	const headComponent = birdComponentLibrary.getRandomComponent('head');
	if (headComponent) {
		components.push({ component: headComponent, partType: 'head' });
		console.log('添加头部组件:', headComponent.fileName);
	}

	// 3. 腹部（可选）
	const bellyComponent = birdComponentLibrary.getRandomComponent('belly');
	if (bellyComponent) {
		components.push({ component: bellyComponent, partType: 'belly' });
		console.log('添加腹部组件:', bellyComponent.fileName);
	}

	// 4. 翅膀（对称，可多个）
	const wingCount = Math.floor(Math.random() * 3) + 1; // 1-3对翅膀
	for (let i = 0; i < wingCount; i++) {
		const wingComponent = birdComponentLibrary.getRandomComponent('wing');
		if (wingComponent) {
			components.push({ component: wingComponent, partType: 'wing', index: i });
			console.log('添加翅膀组件:', wingComponent.fileName);
		}
	}

	// 5. 尾巴（可选）
	const tailComponent = birdComponentLibrary.getRandomComponent('tail');
	if (tailComponent) {
		components.push({ component: tailComponent, partType: 'tail' });
		console.log('添加尾部组件:', tailComponent.fileName);
	}

	// 6. 足部（对称，可多个）
	const footCount = Math.floor(Math.random() * 2) + 1; // 1-2对足部
	for (let i = 0; i < footCount; i++) {
		const footComponent = birdComponentLibrary.getRandomComponent('foot');
		if (footComponent) {
			components.push({ component: footComponent, partType: 'foot', index: i });
			console.log('添加足部组件:', footComponent.fileName);
		}
	}

	// 组装组件到鸟类模型
	for (const { component, partType, index } of components) {
		if (!component.model) continue;

		const modelClone = component.model.clone();

		// 应用材质预处理
		modelClone.traverse((child) => {
			if (child.isMesh && child.material) {
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				const newMaterials = [];

				materials.forEach(material => {
					try {
						if (!(material instanceof THREE.MeshStandardMaterial)) {
							const newMaterial = new THREE.MeshStandardMaterial();

							// 复制颜色和纹理
							if (material.color) newMaterial.color.copy(material.color);
							if (material.map) newMaterial.map = material.map;
							if (material.normalMap) newMaterial.normalMap = material.normalMap;
							if (material.roughnessMap) newMaterial.roughnessMap = material.roughnessMap;
							if (material.metalnessMap) newMaterial.metalnessMap = material.metalnessMap;
							if (material.emissiveMap) newMaterial.emissiveMap = material.emissiveMap;

							// 复制数值属性
							if (typeof material.roughness === 'number') newMaterial.roughness = material.roughness;
							if (typeof material.metalness === 'number') newMaterial.metalness = material.metalness;
							if (typeof material.emissiveIntensity === 'number') newMaterial.emissiveIntensity = material.emissiveIntensity;

							// 设置默认值
							newMaterial.roughness = 0.2; // 稍微增加粗糙度
							newMaterial.metalness = 0.6; // 降低金属度以增加亮度
							newMaterial.transparent = material.transparent || false;
							newMaterial.opacity = material.opacity !== undefined ? material.opacity : 1.0;
							newMaterial.side = material.side || THREE.FrontSide;

							// 移除可能导致问题的回调
							delete newMaterial.onBuild;
							delete newMaterial.onBeforeCompile;

							newMaterials.push(newMaterial);
        } else {
							// 如果已经是 MeshStandardMaterial，也清理一下回调
							delete material.onBuild;
							delete material.onBeforeCompile;
							newMaterials.push(material);
						}
					} catch (propError) {
						console.warn(`处理材质属性失败，使用默认值:`, propError);
						newMaterials.push(new THREE.MeshStandardMaterial({ color: 0x888888 }));
					}
				});
				child.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;
			}
		});

		// 根据部位类型设置位置和朝向
		switch (partType) {
			case 'chest':
				// 胸部作为中心，不需要额外变换
				break;
			case 'head':
				modelClone.position.set(0, 1.5, 0); // 在胸部上方
				break;
			case 'belly':
				modelClone.position.set(0, -1, 0); // 在胸部下方
				break;
			case 'wing':
				// 翅膀对称分布
				const INWARD_OFFSET = 0.3; // 向内偏移量（米）
				const wingX = index % 2 === 0 ? (-2 + INWARD_OFFSET) : (2 - INWARD_OFFSET); // 左右交替并向内贴合
				const wingY = 0.5;
				const wingZ = 0.2;
				modelClone.position.set(wingX, wingY, wingZ);
				modelClone.rotation.z = index % 2 === 0 ? 0.3 : -0.3; // 轻微展开
				break;
			case 'tail':
				modelClone.position.set(0, -1.5, 1); // 在腹部后方
				modelClone.rotation.x = 0.2; // 向下倾斜
				break;
			case 'foot':
				// 足部对称分布
				const FOOT_INWARD_OFFSET = 0.3; // 足部向内偏移量（米）
				const footX = index % 2 === 0 ? (-0.8 + FOOT_INWARD_OFFSET) : (0.8 - FOOT_INWARD_OFFSET);
				const footY = -2;
				const footZ = 0.5;
				modelClone.position.set(footX, footY, footZ);
				break;
		}

		// 设置userData用于序列化
		modelClone.userData.partType = partType;
		modelClone.userData.fileName = component.fileName || '';

		// 设置阴影
		modelClone.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		birdMesh.add(modelClone);
	}

	console.log(`鸟类组装完成: ${components.length} 个组件`);

	// 设置鸟类标识，用于鼠标选择检测
	birdMesh.name = 'RandomBirdAssembly';

	return birdMesh;
}

// 根据性格选择下一个行为
FlyingBird.prototype.chooseNextBehavior = function() {
	const personalityWeights = {
		[ BIRD_PERSONALITIES.OBSERVER ]: { hover: 0.7, patrol: 0.25, travel: 0.05 },
		[ BIRD_PERSONALITIES.PATROL ]: { hover: 0.2, patrol: 0.7, travel: 0.1 },
		[ BIRD_PERSONALITIES.TRAVELER ]: { hover: 0.1, patrol: 0.2, travel: 0.7 },
		[ BIRD_PERSONALITIES.ACTIVE ]: { hover: 0.25, patrol: 0.25, travel: 0.5 }
	};

	const weights = personalityWeights[this.personality];
	const random = Math.random();

	let cumulative = 0;
	for (const [behavior, weight] of Object.entries(weights)) {
		cumulative += weight;
		if (random <= cumulative) {
			this.currentBehavior = behavior;
			break;
		}
	}

	this.behaviorStartTime = Date.now();
	this.behaviorDuration = 3000 + Math.random() * 7000; // 3-10秒

	// 初始化行为
	this.initializeBehavior();
};

// 初始化当前行为
FlyingBird.prototype.initializeBehavior = function() {
	switch (this.currentBehavior) {
		case 'hover':
			this.initializeHover();
			break;
		case 'patrol':
			this.initializePatrol();
			break;
		case 'travel':
			this.initializeTravel();
			break;
	}
};

// 初始化悬停行为
FlyingBird.prototype.initializeHover = function() {
	const treePos = this.currentTree.position;
	const treeHeight = this.currentTree.height; // 树干高度
	const crownHeight = 4; // 树冠高度估计
	const totalTreeHeight = treeHeight + crownHeight; // 树木总高度

	// 悬停高度应该在树干顶部到树冠顶部的范围内
	const minHoverHeight = treeHeight * 0.8; // 最低从树干80%高度开始
	const maxHoverHeight = totalTreeHeight * 0.9; // 最高到树木总高的90%
	const hoverHeight = minHoverHeight + Math.random() * (maxHoverHeight - minHoverHeight);

	const hoverOffset = new THREE.Vector3(
		(Math.random() - 0.5) * 4, // X偏移 ±2
		hoverHeight + window.debugParams.heightOffset, // Y位置基于树木高度 + 全局高度偏移
		(Math.random() - 0.5) * 4  // Z偏移 ±2
	);
	this.hoverPosition = treePos.clone().add(hoverOffset);
};

// 初始化巡逻行为
FlyingBird.prototype.initializePatrol = function() {
	const treeCenter = this.currentTree.position;
	const treeHeight = this.currentTree.height;
	const crownHeight = 4;
	const totalTreeHeight = treeHeight + crownHeight;

	const radius = 2 + Math.random() * 3; // 飞行半径 2-5米
	const baseHeight = treeHeight * 0.7 + Math.random() * (totalTreeHeight * 0.2) + window.debugParams.heightOffset; // 基础高度在树木70%-90%范围内 + 全局高度偏移

	// 创建巡逻路径（椭圆形或花朵形）
	const pathType = Math.random() > 0.5 ? 'ellipse' : 'flower';
	const patrolPath = PathGenerator.createPatrolPath(treeCenter, pathType, {
		radiusX: radius,
		radiusZ: radius * 0.8, // 椭圆形
		height: baseHeight,
		petals: 5 + Math.floor(Math.random() * 3) // 5-7花瓣
	});

	// 创建路径跟随器
	this.pathFollower = {
		pathFunction: patrolPath,
		currentT: 0,
		speed: 0.001 + Math.random() * 0.001, // t变化速度
		getNextPoint: function(dt = 0.016) {
			const nextT = (this.currentT + this.speed * dt) % 1;
			return this.pathFunction(nextT);
		},
		update: function(dt = 0.016) {
			this.currentT = (this.currentT + this.speed * dt) % 1;
		},
		isFinished: function() { return false; } // 巡逻是循环的
	};
};

// 初始化穿梭行为
FlyingBird.prototype.initializeTravel = function() {
	// 选择目标树木（不包括当前树木）
	const availableTrees = treePositions.filter(tree => tree !== this.currentTree);
	if (availableTrees.length === 0) {
		// 如果没有其他树木，回退到巡逻
		this.currentBehavior = 'patrol';
		this.initializePatrol();
		return;
	}

	this.targetTree = availableTrees[Math.floor(Math.random() * availableTrees.length)];

	// 从当前位置开始
	const startPos = this.mesh.position.clone();

	// 目标位置在目标树合理高度范围内
	const targetTreeHeight = this.targetTree.height;
	const targetCrownHeight = 8;
	const targetTotalHeight = targetTreeHeight + targetCrownHeight;
	const targetHoverHeight = targetTreeHeight * 0.8 + Math.random() * (targetTotalHeight * 0.1) + window.debugParams.heightOffset;

	const endPos = this.targetTree.position.clone().add(new THREE.Vector3(
		(Math.random() - 0.5) * 4,
		targetHoverHeight,
		(Math.random() - 0.5) * 4
	));

	// 创建平滑的穿梭路径
	const travelPath = PathGenerator.createBirdTravelPath(startPos, endPos, {
		arcHeight: null, // 自动计算
		useCubic: Math.random() > 0.5 // 随机选择二次或三次贝塞尔
	});

	// 计算路径长度和速度（用于steering）
	const distance = startPos.distanceTo(endPos);
	const speed = 0.002 + Math.random() * 0.003; // 飞行速度
	const duration = distance / speed * 1000; // 转换为毫秒

	// 创建路径跟随器
	this.pathFollower = {
		pathFunction: travelPath,
		currentT: 0,
		speed: 1 / (duration / 1000), // t变化速度（每秒）
		startTime: Date.now(),
		duration: duration,
		getNextPoint: function(dt = 0.016) {
			const elapsed = Date.now() - this.startTime;
			const nextT = Math.min(elapsed / this.duration, 1);
			return this.pathFunction(nextT);
		},
		update: function(dt = 0.016) {
			// travel的update由steering驱动，不需要额外逻辑
		},
		isFinished: function() {
			const elapsed = Date.now() - this.startTime;
			return elapsed >= this.duration;
		}
	};

	// 存储travel相关数据（用于清理）
	this.travelStartPos = startPos;
	this.travelEndPos = endPos;
	this.travelDistance = distance;
	this.travelDuration = duration;
};

// 移除鸟类（带淡出效果）
FlyingBird.prototype.remove = function(immediate = false) {
	if (!this.isAlive) return;

	if (immediate || this.isFadingOut) {
		// 立即移除
		this.isAlive = false;
		// 取消任何动画
		if (this.fadeInAnimation) {
			this.fadeInAnimation();
			this.fadeInAnimation = null;
		}
		if (this.fadeOutAnimation) {
			this.fadeOutAnimation();
			this.fadeOutAnimation = null;
		}
		if (this.mesh.parent) {
			this.mesh.parent.remove(this.mesh);
		}
		console.log('飞行鸟类已立即移除');
        } else {
		// 开始淡出动画
		this.isFadingOut = true;
		// 取消淡入动画
		if (this.fadeInAnimation) {
			this.fadeInAnimation();
			this.fadeInAnimation = null;
		}
		// 开始淡出
		this.fadeOutAnimation = animateOpacity(this.mesh, 1, 0, BIRD_FADE_OUT_MS, easeInOut, () => {
			// 淡出完成后移除
			this.isAlive = false;
			if (this.mesh.parent) {
				this.mesh.parent.remove(this.mesh);
			}
			console.log('飞行鸟类已淡出并移除');
			this.fadeOutAnimation = null;
		});
	}
};

// 创建飞行路径（保留旧函数以向后兼容）
function createFlightPath(treeCenter, startPosition) {
	const radius = 2 + Math.random() * 3; // 飞行半径 2-5米
	const heightRange = 2; // 高度变化范围
	const speed = 0.001 + Math.random() * 0.002; // 飞行速度

	return function(time) {
		const angle = time * speed;
		const height = Math.sin(time * speed * 0.5) * heightRange;

		const x = treeCenter.x + Math.cos(angle) * radius;
		const y = treeCenter.y + height + Math.sin(time * speed * 0.3) * 0.5;
		const z = treeCenter.z + Math.sin(angle) * radius;

		return new THREE.Vector3(x, y, z);
	};
}

// 更新飞行鸟类（使用物理系统和steering behaviors）
function updateFlyingBirds() {
	const currentTime = Date.now();
	const deltaTime = 0.016; // 假设60FPS，16ms每帧

	flyingBirds.forEach(bird => {
		if (!bird.isAlive) return;

		const elapsed = currentTime - bird.startTime;

		// 检查寿命
		if (elapsed >= bird.lifetime) {
			// 开始淡出动画
			if (!bird.isFadingOut) {
				bird.isFadingOut = true;
				// 取消任何正在进行的淡入动画
				if (bird.fadeInAnimation) {
					bird.fadeInAnimation();
					bird.fadeInAnimation = null;
				}
				// 开始淡出
				bird.fadeOutAnimation = animateOpacity(bird.mesh, 1, 0, BIRD_FADE_OUT_MS, easeInOut, () => {
					// 淡出完成后移除
					bird.isAlive = false;
					if (bird.mesh.parent) {
						bird.mesh.parent.remove(bird.mesh);
					}
					console.log('飞行鸟类寿命结束，已淡出并移除');
					bird.fadeOutAnimation = null;
				});
			}
			// 如果正在淡出，继续更新但不执行其他逻辑
			return;
		}

		// 检查是否需要切换行为
		const behaviorElapsed = currentTime - bird.behaviorStartTime;
		if (behaviorElapsed >= bird.behaviorDuration) {
			bird.chooseNextBehavior();
		}

		// 根据当前行为计算steering力
		let steeringForce = new THREE.Vector3();
		switch (bird.currentBehavior) {
			case 'hover':
				steeringForce = calculateHoverSteering(bird);
				break;
			case 'patrol':
				steeringForce = calculatePatrolSteering(bird);
				break;
			case 'travel':
				steeringForce = calculateTravelSteering(bird);
				break;
		}

		// 应用steering力到加速度
		bird.acceleration.add(steeringForce);

		// 积分：加速度 -> 速度 -> 位置
		bird.velocity.add(bird.acceleration.clone().multiplyScalar(deltaTime));
		bird.velocity.clampLength(0, bird.maxSpeed); // 限制最大速度
		bird.mesh.position.add(bird.velocity.clone().multiplyScalar(deltaTime));

		// 清空加速度（为下一帧准备）
		bird.acceleration.set(0, 0, 0);

		// 更新朝向（基于速度方向）
		updateBirdOrientation(bird, bird.mesh.position, currentTime);

		// 添加轻微的翅膀拍动动画
		bird.mesh.rotation.x = Math.sin(currentTime * 0.01) * 0.05;
		bird.mesh.rotation.z = Math.sin(currentTime * 0.015) * 0.02;
	});

	// 清理死亡的鸟类
	flyingBirds = flyingBirds.filter(bird => bird.isAlive);
}

// 更新悬停行为
function updateHoverBehavior(bird, currentTime) {
	if (!bird.hoverPosition) return bird.mesh.position.clone();

	// 悬停时轻微晃动
	const hoverTime = currentTime * 0.005;
	const wobbleX = Math.sin(hoverTime) * 0.1;
	const wobbleY = Math.sin(hoverTime * 1.3) * 0.05;
	const wobbleZ = Math.sin(hoverTime * 0.7) * 0.1;

	return bird.hoverPosition.clone().add(new THREE.Vector3(wobbleX, wobbleY, wobbleZ));
}

// 更新巡逻行为
function updatePatrolBehavior(bird, currentTime) {
	if (!bird.flightPath) return bird.mesh.position.clone();
	return bird.flightPath(currentTime);
}

// 更新穿梭行为
function updateTravelBehavior(bird, currentTime) {
	if (!bird.flightPath) return bird.mesh.position.clone();

	const newPosition = bird.flightPath(currentTime);

	// 检查飞行进度
	const elapsed = currentTime - bird.behaviorStartTime;
	const progress = elapsed / bird.travelDuration;

	if (progress >= 1.0) {
		// 飞行完成，切换到目标树木
		bird.currentTree = bird.targetTree;
		bird.targetTree = null;
		// 清理飞行数据
		bird.travelStartPos = null;
		bird.travelEndPos = null;
		bird.travelDistance = null;
		bird.travelDuration = null;
		// 立即切换到新行为（通常会选择悬停或巡逻）
		bird.chooseNextBehavior();
	}

	return newPosition;
}

// 计算悬停行为的steering力
function calculateHoverSteering(bird) {
	if (!bird.hoverPosition) return new THREE.Vector3();

	const debug = window.debugParams;

	// 主要使用arrive到达悬停位置
	const arriveForce = bird.steering.arrive(bird.hoverPosition, {
		maxSpeed: debug.maxSpeed * 0.5,
		maxForce: debug.maxForce * 0.8,
		arrivalRadius: debug.arrivalRadius
	});

	// 添加轻微的wander让悬停更自然
	const wanderForce = bird.steering.wander({
		wanderStrength: debug.wanderStrength,
		maxSpeed: debug.maxSpeed * 0.2,
		maxForce: debug.maxForce * 0.3
	});

	// 避开其他树木
	const treePositions = getTreePositions();
	const avoidForce = bird.steering.avoid(treePositions, {
		maxForce: debug.maxForce * 0.4,
		avoidRadius: debug.avoidRadius,
		lookahead: debug.lookahead
	});

	return arriveForce.add(wanderForce).add(avoidForce);
}

// 计算巡逻行为的steering力
function calculatePatrolSteering(bird) {
	if (!bird.pathFollower) return new THREE.Vector3();

	const debug = window.debugParams;

	// 获取路径上的下一个参考点
	const targetPoint = bird.pathFollower.getNextPoint();

	// 使用arrive到达参考点
	const arriveForce = bird.steering.arrive(targetPoint, {
		maxSpeed: debug.maxSpeed,
		maxForce: debug.maxForce,
		arrivalRadius: debug.arrivalRadius
	});

	// 避开其他树木
	const treePositions = getTreePositions();
	const avoidForce = bird.steering.avoid(treePositions, {
		maxForce: debug.maxForce * 0.6,
		avoidRadius: debug.avoidRadius,
		lookahead: debug.lookahead
	});

	// 更新路径跟随器
	bird.pathFollower.update();

	return arriveForce.add(avoidForce);
}

// 计算穿梭行为的steering力
function calculateTravelSteering(bird) {
	if (!bird.pathFollower) return new THREE.Vector3();

	const debug = window.debugParams;

	// 获取路径上的下一个参考点
	const targetPoint = bird.pathFollower.getNextPoint();

	// 使用seek到达参考点（travel时速度应该快一些）
	const seekForce = bird.steering.seek(targetPoint, {
		maxSpeed: debug.maxSpeed * 1.2,
		maxForce: debug.maxForce * 1.1
	});

	// 避开其他树木
	const treePositions = getTreePositions();
	const avoidForce = bird.steering.avoid(treePositions, {
		maxForce: debug.maxForce * 0.5,
		avoidRadius: debug.avoidRadius * 0.8, // travel时避开半径相对小一些
		lookahead: debug.lookahead * 0.7     // 预测距离相对小一些
	});

	// 更新路径跟随器
	bird.pathFollower.update();

	// 检查是否到达终点
	if (bird.pathFollower.isFinished()) {
		// 切换到目标树木
		bird.currentTree = bird.targetTree;
		bird.targetTree = null;
		// 清理travel相关数据
		bird.pathFollower = null;
		bird.travelStartPos = null;
		bird.travelEndPos = null;
		bird.travelDistance = null;
		bird.travelDuration = null;
		// 立即切换到新行为
		bird.chooseNextBehavior();
	}

	return seekForce.add(avoidForce);
}

// 获取树木位置数组（用于避障）
function getTreePositions() {
	return treePositions.map(tree => tree.position);
}

// 更新鸟类朝向（基于速度方向）
function updateBirdOrientation(bird, currentPosition, currentTime) {
	// 如果速度很小，保持当前朝向
	if (bird.velocity.lengthSq() < 0.01) {
		return;
	}

	// 计算目标朝向（基于速度方向）
	const velocityDir = bird.velocity.clone().normalize();
	const targetPosition = currentPosition.clone().add(velocityDir);

	// 平滑朝向目标
	bird.mesh.lookAt(targetPosition.x, targetPosition.y, targetPosition.z);

	// 添加一些随机的小幅摆头（让鸟看起来更生动）
	const randomYaw = Math.sin(currentTime * 0.002) * 0.1;
	const randomPitch = Math.sin(currentTime * 0.003) * 0.05;

	bird.mesh.rotation.y += randomYaw;
	bird.mesh.rotation.x += randomPitch;
}

// 启动动画循环
animate();

function animate() {
	requestAnimationFrame(animate);

	// 生成新的飞行鸟类
	generateFlyingBirds();

	// 更新飞行鸟类的位置和动画
	updateFlyingBirds();

	// 更新观察模式
	updateObservationMode();

	// 只有在controls初始化后才更新（观察模式下不更新controls）
	if (controls && !observationMode.active) {
		controls.update();
	}
	render();
}