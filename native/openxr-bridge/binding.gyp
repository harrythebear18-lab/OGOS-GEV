{
  "targets": [
    {
      "target_name": "xr_bridge",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/xr_bindings.cpp",
        "src/xr_session.cpp",
        "src/xr_encoder.cpp",
        "src/xr_decoder.cpp",
        "src/xr_sharedmemory.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src",
        "src/include",
        "openxr/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN",
        "_CRT_SECURE_NO_WARNINGS"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "-lkernel32.lib",
              "-luser32.lib",
              "-ld3d11.lib",
              "-ldxgi.lib",
              "-ldxguid.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "RuntimeLibrary": 2,
                "AdditionalOptions": ["/std:c++17"]
              }
            }
          }
        ]
      ]
    }
  ]
}
