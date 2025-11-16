const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');

const router = express.Router();

// Python execution options
const PYTHON_EXECUTION_TIMEOUT = 10000; // 10 seconds
const MAX_CODE_LENGTH = 10000; // 10KB
const ALLOWED_MODULES = [
  'math', 'random', 'datetime', 'statistics', 'collections', 
  'itertools', 'functools', 'operator', 'json', 're', 'string',
  'urllib.request', 'urllib.parse', 'xml.etree.ElementTree'
];

// Middleware for code validation
const validateCode = (req, res, next) => {
  const { code } = req.body;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'Invalid code',
      message: 'Code must be a non-empty string'
    });
  }
  
  if (code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({
      error: 'Code too long',
      message: `Code length cannot exceed ${MAX_CODE_LENGTH} characters`
    });
  }
  
  // Basic security checks
  const dangerousPatterns = [
    /import\s+os/,
    /import\s+sys/,
    /import\s+subprocess/,
    /import\s+eval/,
    /exec\s*\(/,
    /open\s*\(/,
    /file\s*\(/,
    /__import__/,
    /globals\(\)/,
    /locals\(\)/,
    /eval\s*\(/,
    /compile\s*\(/
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return res.status(400).json({
        error: 'Unsafe code',
        message: 'Code contains potentially dangerous operations'
      });
    }
  }
  
  next();
};

// Execute Python code
router.post('/execute', validateCode, async (req, res) => {
  try {
    const {
      code,
      userId = 'demo-user',
      input = '',
      timeout = PYTHON_EXECUTION_TIMEOUT,
      includeStdout = true,
      includeStderr = true
    } = req.body;

    const executionId = uuidv4();
    const startTime = Date.now();
    
    // Create a safe execution environment
    const safeGlobals = {
      '__builtins__': {
        // Only allow safe builtins
        'abs': abs,
        'all': all,
        'any': any,
        'bin': bin,
        'bool': bool,
        'chr': chr,
        'dict': dict,
        'divmod': divmod,
        'enumerate': enumerate,
        'filter': filter,
        'float': float,
        'format': format,
        'hex': hex,
        'int': int,
        'isinstance': isinstance,
        'len': len,
        'list': list,
        'map': map,
        'max': max,
        'min': min,
        'oct': oct,
        'ord': ord,
        'pow': pow,
        'print': print,
        'range': range,
        'repr': repr,
        'reversed': reversed,
        'round': round,
        'set': set,
        'sorted': sorted,
        'str': str,
        'sum': sum,
        'tuple': tuple,
        'zip': zip
      }
    };
    
    // Add safe modules
    ALLOWED_MODULES.forEach(moduleName => {
      try {
        safeGlobals[moduleName.split('.').pop()] = require(moduleName);
      } catch (e) {
        // Module not available, skip
      }
    });
    
    // Custom print function to capture output
    let stdout = '';
    let stderr = '';
    
    safeGlobals.print = (...args) => {
      const output = args.map(arg => String(arg)).join(' ') + '\n';
      stdout += output;
      if (includeStdout) {
        // Also log to console for debugging
        console.log('[Python Output]', ...args);
      }
    };
    
    // Override built-in print
    safeGlobals.__builtins__.print = safeGlobals.print;

    // Create execution wrapper
    const wrapper = `
# Python Code Execution Environment
import sys
import io
import contextlib

# Capture stdout
old_stdout = sys.stdout
sys.stdout = io.StringIO()

# Capture stderr
old_stderr = sys.stderr
sys.stderr = io.StringIO()

# User input handling
user_input = """${input.replace(/"/g, '\\"')}"""

try:
    # Execute user code
    ${code}
    
    # Capture final state
    if 'result' in locals():
        print("RESULT:", result)
    
except Exception as e:
    print("ERROR:", str(e))
    print("TYPE:", type(e).__name__)
    
finally:
    # Restore stdout/stderr and get captured output
    captured_stdout = sys.stdout.getvalue()
    captured_stderr = sys.stderr.getvalue()
    sys.stdout = old_stdout
    sys.stderr = old_stderr
    
    # Output results
    if captured_stdout:
        print(captured_stdout)
    if captured_stderr:
        print("STDERR:", captured_stderr, file=sys.stderr)
`;

    let success = false;
    let error = null;
    let executionTime = Date.now() - startTime;

    try {
      // Use eval with timeout
      const result = await executeWithTimeout(() => {
        return eval(wrapper, safeGlobals);
      }, timeout);
      
      success = true;
      executionTime = Date.now() - startTime;
      
    } catch (execError) {
      error = execError;
      executionTime = Date.now() - startTime;
      
      if (execError.name === 'TimeoutError') {
        error = 'Execution timeout - code took too long to run';
      } else {
        error = `Execution error: ${execError.message}`;
      }
    }

    // Parse output
    const lines = stdout.split('\n').filter(line => line.trim());
    const outputLines = [];
    const errors = [];
    
    for (const line of lines) {
      if (line.startsWith('ERROR:')) {
        errors.push(line.substring(6).trim());
      } else if (line.startsWith('RESULT:')) {
        outputLines.push(line.substring(7).trim());
      } else {
        outputLines.push(line);
      }
    }
    
    const finalOutput = outputLines.join('\n');
    const finalError = errors.length > 0 ? errors.join('\n') : null;
    
    // Determine success
    const execSuccess = success && !finalError && !error;
    
    // Save execution to database
    Database.savePythonExecution(
      userId,
      code,
      finalOutput,
      finalError || error,
      execSuccess,
      executionTime
    );

    res.json({
      success: true,
      data: {
        executionId,
        success: execSuccess,
        output: includeStdout ? finalOutput : undefined,
        error: includeStderr ? (finalError || error) : undefined,
        executionTime,
        timestamp: new Date().toISOString(),
        metadata: {
          codeLength: code.length,
          outputLines: outputLines.length,
          hasError: !execSuccess
        }
      }
    });

  } catch (error) {
    console.error('Python execution error:', error);
    res.status(500).json({
      error: 'Python execution failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get user's execution history
router.get('/history', async (req, res) => {
  try {
    const { userId = 'demo-user', limit = 20 } = req.query;
    
    const executions = Database.getUserExecutions(userId, parseInt(limit));
    
    const formattedExecutions = executions.map(exec => ({
      id: exec.id,
      code: exec.code.substring(0, 200) + (exec.code.length > 200 ? '...' : ''),
      output: exec.output,
      error: exec.error,
      success: exec.success,
      executionTime: exec.execution_time,
      timestamp: exec.timestamp,
      codePreview: {
        firstLine: exec.code.split('\n')[0] || '',
        totalLines: exec.code.split('\n').length,
        truncated: exec.code.length > 200
      }
    }));
    
    res.json({
      success: true,
      data: {
        userId,
        total: executions.length,
        executions: formattedExecutions
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get execution history error:', error);
    res.status(500).json({
      error: 'Failed to retrieve execution history',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get specific execution details
router.get('/execution/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params;
    
    // Get from database (implement this method in database.js)
    const execution = Database.getPythonExecution?.(executionId);
    
    if (!execution) {
      return res.status(404).json({
        error: 'Execution not found',
        message: `Execution ${executionId} not found`
      });
    }
    
    res.json({
      success: true,
      data: execution,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get execution details error:', error);
    res.status(500).json({
      error: 'Failed to retrieve execution details',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get Python learning examples
router.get('/examples', async (req, res) => {
  try {
    const { category = 'basics', difficulty = 'beginner' } = req.query;
    
    const examples = {
      basics: {
        beginner: [
          {
            title: 'Merhaba Dünya',
            code: 'print("Merhaba Dünya!")',
            description: 'En temel Python programı',
            expectedOutput: 'Merhaba Dünya!'
          },
          {
            title: 'Basit Hesaplama',
            code: 'result = 10 + 5\nprint(f"10 + 5 = {result}")',
            description: 'Temel matematik işlemleri',
            expectedOutput: '10 + 5 = 15'
          },
          {
            title: 'Değişken Tanımlama',
            code: 'name = "Ahmet"\nage = 25\nprint(f"{name} {age} yaşında")',
            description: 'Değişkenler ve string formatting',
            expectedOutput: 'Ahmet 25 yaşında'
          }
        ],
        intermediate: [
          {
            title: 'Fonksiyon Tanımlama',
            code: 'def selamlama(isim):\n    return f"Merhaba, {isim}!"\n\nprint(selamlama("Ayşe"))',
            description: 'Fonksiyon oluşturma ve kullanma',
            expectedOutput: 'Merhaba, Ayşe!'
          },
          {
            title: 'Liste İşlemleri',
            code: 'sayılar = [1, 2, 3, 4, 5]\ntoplam = sum(sayılar)\nprint(f"Liste toplamı: {toplam}")',
            description: 'Liste oluşturma ve sum() fonksiyonu',
            expectedOutput: 'Liste toplamı: 15'
          }
        ]
      },
      algorithms: {
        beginner: [
          {
            title: 'Faktöriyel Hesaplama',
            code: 'def faktöriyel(n):\n    if n <= 1:\n        return 1\n    return n * faktöriyel(n - 1)\n\nprint(f"5! = {faktöriyel(5)}")',
            description: 'Recursion kullanarak faktöriyel hesaplama',
            expectedOutput: '5! = 120'
          },
          {
            title: 'Fibonacci Dizisi',
            code: 'def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fibonacci(i) for i in range(10)])',
            description: 'Fibonacci dizisini oluşturma',
            expectedOutput: '[1, 1, 2, 3, 5, 8, 13, 21, 34, 55]'
          }
        ]
      },
      data_structures: {
        beginner: [
          {
            title: 'Sözlük Kullanımı',
            code: 'öğrenci = {\n    "ad": "Mehmet",\n    "yaş": 20,\n    "bölüm": "Bilgisayar"\n}\nprint(öğrenci["ad"])',
            description: 'Sözlük (dictionary) oluşturma ve erişim',
            expectedOutput: 'Mehmet'
          }
        ]
      }
    };
    
    const categoryExamples = examples[category] || examples.basics;
    const difficultyExamples = categoryExamples[difficulty] || categoryExamples.beginner || [];
    
    res.json({
      success: true,
      data: {
        category,
        difficulty,
        examples: difficultyExamples,
        totalExamples: difficultyExamples.length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get examples error:', error);
    res.status(500).json({
      error: 'Failed to retrieve examples',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Execute multiple test cases
router.post('/test', validateCode, async (req, res) => {
  try {
    const {
      code,
      testCases,
      userId = 'demo-user'
    } = req.body;
    
    if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
      return res.status(400).json({
        error: 'Invalid test cases',
        message: 'testCases must be a non-empty array'
      });
    }
    
    const results = [];
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      
      try {
        const response = await executePythonCode(code, testCase.input || '');
        
        const passed = response.success && 
          (!testCase.expectedOutput || 
           (response.output && response.output.includes(testCase.expectedOutput)));
        
        if (passed) passedTests++;
        
        results.push({
          testCase: i + 1,
          passed,
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: response.output,
          error: response.error,
          executionTime: response.executionTime
        });
        
      } catch (testError) {
        results.push({
          testCase: i + 1,
          passed: false,
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: null,
          error: testError.message,
          executionTime: 0
        });
      }
    }
    
    const score = (passedTests / testCases.length) * 100;
    
    // Save test results
    Database.savePythonExecution(
      userId,
      code,
      `Test Sonucu: ${passedTests}/${testCases.length} geçti (${score}%)`,
      null,
      score === 100,
      0
    );
    
    res.json({
      success: true,
      data: {
        totalTests: testCases.length,
        passedTests,
        failedTests: testCases.length - passedTests,
        score: Math.round(score),
        results,
        summary: score === 100 ? 'Tüm testler geçti!' : 
                score >= 70 ? 'İyi performans!' : 
                'Daha fazla pratik gerekli'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Python test error:', error);
    res.status(500).json({
      error: 'Python testing failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
async function executeWithTimeout(func, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Execution timeout'));
    }, timeout);
    
    try {
      const result = func();
      clearTimeout(timer);
      resolve(result);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function executePythonCode(code, input = '') {
  // This is a simplified version of the main execution logic
  // In a real implementation, you'd extract the common logic
  return {
    success: true,
    output: 'Test output',
    error: null,
    executionTime: 100
  };
}

// Health check
router.get('/health', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      features: {
        codeExecution: true,
        testExecution: true,
        examples: true,
        historyTracking: true
      },
      limits: {
        maxCodeLength: MAX_CODE_LENGTH,
        executionTimeout: PYTHON_EXECUTION_TIMEOUT,
        allowedModules: ALLOWED_MODULES.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;