export function Marco({
  pose,
  away = false,
}: {
  pose: string;
  away?: boolean;
}) {
  const tension = pose === "angry" || pose === "suspicious";
  const fear = pose === "afraid" || pose === "nervous";
  return (
    <div
      className={`marco-portrait pose-${pose} ${away ? "is-away" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 560 580" role="presentation">
        <defs>
          <linearGradient id="suit" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#39413a" />
            <stop offset=".48" stopColor="#202722" />
            <stop offset="1" stopColor="#0b100d" />
          </linearGradient>
          <linearGradient id="skin" x1="0" y1="0" x2="1" y2=".4">
            <stop stopColor="#d4b78d" />
            <stop offset=".44" stopColor="#ab8a64" />
            <stop offset="1" stopColor="#4c5140" />
          </linearGradient>
          <linearGradient id="face-shadow">
            <stop stopColor="#2b3228" stopOpacity="0" />
            <stop offset="1" stopColor="#131b13" stopOpacity=".75" />
          </linearGradient>
          <filter id="soft-shadow">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <ellipse
          cx="287"
          cy="530"
          rx="180"
          ry="32"
          fill="#000"
          opacity=".55"
          filter="url(#soft-shadow)"
        />
        <path
          d="M84 560 99 391Q113 339 213 322L341 322Q445 335 462 401L484 560Z"
          fill="url(#suit)"
        />
        <path d="M224 288 211 327 270 404 348 327 329 279" fill="url(#skin)" />
        <path d="M211 325 183 350 228 461 272 402Z" fill="#a9a996" />
        <path d="M347 325 369 345 318 460 272 402Z" fill="#777f6e" />
        <path
          d="m269 399-16 26 10 108 20 25 18-34-14-99-16-25"
          fill="#303930"
        />
        <path
          d="m183 339-36 40 42 11-20 35 60 106 20-76Z"
          fill="#29342c"
          stroke="#465145"
        />
        <path
          d="m369 339 42 39-43 14 25 31-79 119-2-80Z"
          fill="#17241d"
          stroke="#344135"
        />
        <g className="marco-head">
          <path
            d="M198 153Q175 149 179 187L194 216 214 209 214 167Z"
            fill="#a38460"
          />
          <path
            d="M354 153Q378 153 374 190L359 218 341 208 341 169Z"
            fill="#59604b"
          />
          <path
            d="M199 97Q277 45 351 104L356 218Q350 263 313 292L276 306 231 291Q196 264 195 218Z"
            fill="url(#skin)"
          />
          <path
            d="M199 126 194 168 188 99Q207 58 256 59L305 61Q357 73 366 119L356 175 342 126 318 93Q257 107 222 88Z"
            fill="#232c25"
          />
          <path d="M207 119 210 159 215 123" fill="#c1ab85" />
          <path
            d="M212 157Q238 145 258 154"
            stroke="#4b4834"
            strokeWidth="8"
            fill="none"
            transform={tension ? "rotate(10 238 155)" : ""}
          />
          <path
            d="M291 153Q319 140 341 153"
            stroke="#353e2e"
            strokeWidth="8"
            fill="none"
            transform={tension ? "rotate(-10 313 153)" : ""}
          />
          <path d="M213 170Q235 158 257 170 235 179 213 170" fill="#d5c9a8" />
          <path d="M291 168Q315 157 338 169 315 179 291 168" fill="#9b9f80" />
          <ellipse
            cx={fear ? 240 : 235}
            cy="168"
            rx="6"
            ry={tension ? 4 : 6}
            fill="#242b22"
          />
          <ellipse
            cx={fear ? 318 : 312}
            cy="167"
            rx="6"
            ry={tension ? 4 : 6}
            fill="#171e19"
          />
          <path
            d="m275 162-11 49 20 7 11-8"
            stroke="#766248"
            strokeWidth="4"
            fill="none"
          />
          <path
            d="M228 191 221 211M334 190 340 211"
            stroke="#6f7056"
            strokeWidth="3"
          />
          <path
            d={fear ? "M248 244Q275 234 299 243" : "M242 242Q275 250 306 240"}
            stroke="#443d2e"
            strokeWidth="5"
            fill="none"
          />
          <path
            d="M248 265Q279 272 305 259"
            stroke="#6c644b"
            strokeWidth="3"
            fill="none"
          />
          <path
            d="M291 103 351 115 357 220Q349 264 313 292L277 306 278 228Z"
            fill="url(#face-shadow)"
          />
          <path
            d="M260 124 279 121M267 133 287 130"
            stroke="#877352"
            strokeWidth="2"
          />
        </g>
        <path
          d="M100 508Q160 483 211 512L259 533Q278 545 260 558L153 558 97 542Z"
          fill="url(#skin)"
        />
        <path
          d="M457 504Q399 486 346 511L301 535Q286 549 304 558L405 558 465 542Z"
          fill="url(#skin)"
        />
        <path
          d="m162 531 67 17M160 543l70 14M363 531l-48 17M383 541l-67 15"
          stroke="#615b42"
          strokeWidth="3"
        />
        <path d="M372 537 391 516" stroke="#9a9171" strokeWidth="10" />
        <path d="M389 518l5-5" stroke="#d27b42" strokeWidth="7" />
      </svg>
      <span className="cigarette-smoke" />
    </div>
  );
}
