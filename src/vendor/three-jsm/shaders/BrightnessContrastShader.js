/**
 * Brightness and contrast adjustment
 * https://github.com/evanw/glfx.js
 * brightness: -1 to 1 (-1 is solid black, 0 is no change, and 1 is solid white)
 * contrast: -1 to 1 (-1 is solid gray, 0 is no change, and 1 is maximum contrast)
 */

const BrightnessContrastShader = {

	name: 'BrightnessContrastShader',

	uniforms: {

		'tDiffuse': { value: null },
		'brightness': { value: 0 },
		'contrast': { value: 0 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;
		uniform float brightness;
		uniform float contrast;

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			gl_FragColor.rgb += brightness;

			if (contrast > 0.0) {
				gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) / (1.0 - contrast) + 0.5;
			} else {
				gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * (1.0 + contrast) + 0.5;
			}

			// Unclamped contrast can push RGB < 0; sRGB output then clamps and looks like
			// crushed, muddy shadows even when “brightness” was not lowered intentionally.
			gl_FragColor.rgb = clamp( gl_FragColor.rgb, 0.0, 1.0 );

		}`

};

export { BrightnessContrastShader };
