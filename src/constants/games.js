import convert from 'color-convert';
import { vec2, mat2 } from 'gl-matrix';
import _ from 'lodash';

import {
  COLORING_MODES,
  CONTROL_TYPES,
  CONTROLS,
  GAME_TYPES,
  TRANSFORM_PARAMS,
} from '../constants/controls';
import { getActualColor } from '../utils/color-utils';

const memoize = fn => {
  const createNewMap = () => new Map();
  const getOrCreate = (map, key, creator) => {
    if (map.has(key)) {
      return map.get(key);
    } else {
      const val = creator();
      map.set(key, val);
      return val;
    }
  };

  const receivers = new Map();
  const symbol = Symbol();

  return function(...args) {
    let current = args.reduce((curr, arg) => {
      return getOrCreate(curr, arg, createNewMap);
    }, getOrCreate(receivers, this, createNewMap));

    return getOrCreate(current, symbol, () => fn.apply(this, args));
  };
};

const generateExclusionTargetLookup = (targets, exclusions) => {
  const exclusionSet = new Set(exclusions);

  return new Map(
    targets.map((target, targetIndex) => {
      const possibleValues = [
        ...targets.slice(targetIndex),
        ...targets.slice(0, targetIndex),
      ].filter((nop, index) => !exclusionSet.has(index));

      return [target, possibleValues];
    }),
  );
};

const createTargetSelectorWithHistory = (historySize, targetSelector) => {
  let previousTargets = [];

  return () => {
    const newTarget = targetSelector(previousTargets);

    previousTargets = [newTarget, ...previousTargets].slice(0, historySize);

    return newTarget;
  };
};

const createSharedTransformSelector = transforms => {
  const totalProbability = transforms.reduce(
    (acc, transform) => acc + transform[TRANSFORM_PARAMS.PROBABILITY],
    0,
  );

  const transformPool = transforms.reduce((pool, transform) => {
    _.times(
      Math.floor(
        100 * transform[TRANSFORM_PARAMS.PROBABILITY] / totalProbability,
      ),
      () => {
        pool.push(transform);
      },
    );

    return pool;
  }, []);

  return () => _.sample(transformPool);
};

const createColorSelector = (
  { targets, transforms, colors, coloringMode = null } = {},
) => {
  const actualColors = colors.map(getActualColor);
  let selector;

  if (coloringMode === null || coloringMode === COLORING_MODES.BY_TRANSFORM) {
    const colorLookup = transforms.reduce((map, transform, index) => {
      map.set(transform, actualColors[index]);
      return map;
    }, new Map());
    selector = (target, transform) => colorLookup.get(transform);
  } else if (coloringMode === COLORING_MODES.GRADIENT) {
    const parsedColors = colors.map(color =>
      convert.hex.rgb(getActualColor(color)),
    );
    const componentMatrixes = _.times(3, componentIndex =>
      mat2.fromValues(
        parsedColors[0][componentIndex],
        parsedColors[3][componentIndex],
        parsedColors[1][componentIndex],
        parsedColors[2][componentIndex],
      ),
    );

    const interpolate = ([x, y], componentIndex) => {
      const clampedX = _.clamp(x, 0, 1);
      const clampedY = _.clamp(y, 0, 1);
      const xInterp = vec2.transformMat2(
        vec2.create(),
        vec2.fromValues(1 - clampedX, clampedX),
        componentMatrixes[componentIndex],
      );
      return vec2.dot(xInterp, vec2.fromValues(1 - clampedY, clampedY));
    };

    selector = (target, transform, point) => {
      const components = _.times(3, componentIndex =>
        interpolate(point, componentIndex),
      );
      return `#${convert.rgb.hex(components)}`;
    };
  } else {
    const colorLookup = targets.reduce((map, target, index) => {
      map.set(target, actualColors[index]);
      return map;
    }, new Map());
    selector = target => colorLookup.get(target);
  }

  return selector;
};

const attractorFactory = ({
  colorSelector,
  targetSelector,
  transforms,
  transformSelector,
}) => {
  const transformMatrixLookup = transforms.reduce((lookup, transform) => {
    const scaleMatrix = mat2.fromScaling(
      mat2.create(),
      vec2.fromValues(
        transform[TRANSFORM_PARAMS.SCALE],
        transform[TRANSFORM_PARAMS.SCALE],
      ),
    );
    const rotationMatrix = mat2.fromRotation(
      mat2.create(),
      transform[TRANSFORM_PARAMS.ROTATION],
    );
    const transformMatrix = mat2.multiply(
      mat2.create(),
      scaleMatrix,
      rotationMatrix,
    );

    lookup.set(transform, transformMatrix);

    return lookup;
  }, new Map());

  let currentPoint = vec2.fromValues(Math.random(), Math.random());
  const moveCurrentPoint = (target, transformMatrix) => {
    const delta = vec2.subtract(vec2.create(), target, currentPoint);
    const currentTemp = vec2.transformMat2(
      vec2.create(),
      delta,
      transformMatrix,
    );

    currentPoint = vec2.add(vec2.create(), currentTemp, currentPoint);

    return currentPoint;
  };

  const getNextPoint = () => {
    const target = targetSelector();
    if (!target) return {};

    const transform = transformSelector(target);
    const transformMatrix = transformMatrixLookup.get(transform);
    const point = moveCurrentPoint(target, transformMatrix);
    const color = colorSelector(target, transform, point);

    return {
      point,
      color,
    };
  };

  // Prime the attractor so that we don't see any random points lingering
  // around outside of the main fractal.
  for (var i = 0; i < 100; i++) {
    getNextPoint();
  }

  return {
    getNextPoint,
  };
};

export default {
  [GAME_TYPES.HISTORY_EXCLUSION]: {
    description:
      'Using the number of targets specified by the Target History control, choose the next target based on the intersection of the exclusion rules. See the “Exclusions” control below for more details.',

    additionalControls: [CONTROL_TYPES.HISTORY],

    createAttractor(targets, controls) {
      const {
        [CONTROL_TYPES.COLORING_MODE]: coloringMode,
        [CONTROL_TYPES.COLORS]: colors,
        [CONTROL_TYPES.EXCLUSIONS]: exclusions,
        [CONTROL_TYPES.TRANSFORMS]: transforms,
      } = controls;

      const getIntersection = (a, b) => new Set([...a].filter(x => b.has(x)));

      const historySize = CONTROLS[CONTROL_TYPES.HISTORY].extractValueFrom(
        controls,
      );
      const possibleTargetLookup = generateExclusionTargetLookup(
        targets,
        exclusions,
      );

      const getPossibleTargets = memoize((n, ...previousTargets) => {
        // If the previous target was undefined it means that there are no
        // other choices.
        if (previousTargets.length && !previousTargets[0]) return [];

        return [
          ...previousTargets
            .map(target => new Set(possibleTargetLookup.get(target)))
            .reduce(getIntersection, new Set(targets)),
        ];
      });

      const targetSelector = createTargetSelectorWithHistory(
        historySize,
        previousTargets =>
          _.sample(
            getPossibleTargets(previousTargets.length, ...previousTargets),
          ),
      );

      const transformSelector = createSharedTransformSelector(transforms);

      return attractorFactory({
        colorSelector: createColorSelector({
          coloringMode,
          colors,
          targets,
          transforms,
        }),
        targetSelector,
        transforms,
        transformSelector,
      });
    },
  },

  [GAME_TYPES.HISTORY_EXCLUSION_2]: {
    description:
      'Similar to the “History Exclusion” variation, however the exclusion rules are only applied if the previously two chosen targets were the same. See the “Exclusions” control below for more details.',

    additionalControls: [],

    createAttractor(targets, controls) {
      const {
        [CONTROL_TYPES.COLORING_MODE]: coloringMode,
        [CONTROL_TYPES.COLORS]: colors,
        [CONTROL_TYPES.EXCLUSIONS]: exclusions,
        [CONTROL_TYPES.TRANSFORMS]: transforms,
      } = controls;

      const possibleTargetLookup = generateExclusionTargetLookup(
        targets,
        exclusions,
      );

      const targetSelector = createTargetSelectorWithHistory(
        2,
        previousTargets => {
          // If the previous target was undefined it means that there are no
          // other choices.
          if (previousTargets.length && !previousTargets[0]) return;

          const uniquePreviousTargets = new Set(previousTargets);

          let possibleTargets =
            uniquePreviousTargets.size === 1
              ? possibleTargetLookup.get(previousTargets[0])
              : targets;

          return _.sample(possibleTargets);
        },
      );

      const transformSelector = createSharedTransformSelector(transforms);

      return attractorFactory({
        colorSelector: createColorSelector({
          coloringMode,
          colors,
          targets,
          transforms,
        }),
        targetSelector,
        transforms,
        transformSelector,
      });
    },
  },

  [GAME_TYPES.TARGET_TRANSFORMS]: {
    description:
      'Instead of choosing a transformation randomly, associate a transform with each target.',

    numTransforms: controls =>
      CONTROLS[CONTROL_TYPES.NUM_TARGETS].extractValueFrom(controls),

    disableTargetColoringMode: true,

    additionalControls: [CONTROL_TYPES.HISTORY],

    createAttractor(targets, controls) {
      const {
        [CONTROL_TYPES.COLORING_MODE]: coloringMode,
        [CONTROL_TYPES.COLORS]: colors,
        [CONTROL_TYPES.EXCLUSIONS]: exclusions,
        [CONTROL_TYPES.TRANSFORMS]: transforms,
      } = controls;

      const transformMap = targets.reduce((map, point, index) => {
        map.set(point, transforms[index]);
        return map;
      }, new Map());

      const getIntersection = (a, b) => new Set([...a].filter(x => b.has(x)));

      const historySize = CONTROLS[CONTROL_TYPES.HISTORY].extractValueFrom(
        controls,
      );
      const possibleTargetLookup = generateExclusionTargetLookup(
        targets,
        exclusions,
      );

      const totalProbability = transforms.reduce(
        (acc, transform) => acc + transform[TRANSFORM_PARAMS.PROBABILITY],
        0,
      );
      const targetPools = targets.reduce((map, target) => {
        const probability = transformMap.get(target)[
          TRANSFORM_PARAMS.PROBABILITY
        ];
        const pool = _.times(
          Math.floor(100 * probability / totalProbability),
          () => target,
        );
        return map.set(target, pool);
      }, new Map());

      const getPossibleTargets = memoize((n, ...previousTargets) => {
        // If the previous target was undefined it means that there are no
        // other choices.
        if (previousTargets.length && !previousTargets[0]) return [];

        const possibleTargetSet = previousTargets
          .map(target => new Set(possibleTargetLookup.get(target)))
          .reduce((intersection, possibleTargets) => {
            return getIntersection(intersection, possibleTargets);
          }, new Set(targets));

        return [...possibleTargetSet].reduce(
          (acc, target) => [...acc, ...targetPools.get(target)],
          [],
        );
      });

      const targetSelector = createTargetSelectorWithHistory(
        historySize,
        previousTargets =>
          _.sample(
            getPossibleTargets(previousTargets.length, ...previousTargets),
          ),
      );

      const transformSelector = target => {
        return transformMap.get(target);
      };

      return attractorFactory({
        colorSelector: createColorSelector({
          targets,
          transforms,
          colors,
          coloringMode,
        }),
        targetSelector,
        transforms,
        transformSelector,
      });
    },
  },
};
