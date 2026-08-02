// TCGA 癌种英文名的文献同义词扩展。
// key 与创建页癌种下拉框提交的 en 名称一致（如 'Stomach adenocarcinoma'）;
// value 是 OpenAlex search 支持的布尔 OR 组内容,组内第一项为 TCGA 原名,
// 其余为文献中的常见等价写法。缩写只收录公认无歧义的（AML/DLBCL/HCC/PDAC 等）。

const CANCER_SYNONYMS = {
  'Pan-cancer': 'pan-cancer OR pancancer OR pan cancer',
  'Adrenocortical carcinoma': 'adrenocortical carcinoma OR adrenal cortical carcinoma OR adrenal cancer',
  'Bladder urothelial carcinoma': 'bladder urothelial carcinoma OR bladder cancer OR urothelial carcinoma OR bladder carcinoma OR transitional cell carcinoma',
  'Breast invasive carcinoma': 'breast invasive carcinoma OR breast cancer OR breast carcinoma OR invasive breast cancer OR mammary carcinoma',
  'Cervical squamous cell carcinoma and endocervical adenocarcinoma': 'cervical squamous cell carcinoma OR cervical cancer OR endocervical adenocarcinoma OR cervical carcinoma OR cervix cancer',
  'Cholangiocarcinoma': 'cholangiocarcinoma OR bile duct cancer OR bile duct carcinoma',
  'Colon adenocarcinoma': 'colon adenocarcinoma OR colon cancer OR colorectal cancer OR colorectal carcinoma OR colon carcinoma',
  'Diffuse large B-cell lymphoma': 'diffuse large B-cell lymphoma OR DLBCL OR diffuse large B cell lymphoma',
  'Esophageal carcinoma': 'esophageal carcinoma OR esophageal cancer OR oesophageal cancer OR esophagus cancer OR oesophageal carcinoma',
  'Glioblastoma multiforme': 'glioblastoma multiforme OR glioblastoma OR GBM',
  'Head and neck squamous cell carcinoma': 'head and neck squamous cell carcinoma OR head and neck cancer OR HNSCC OR head and neck squamous carcinoma',
  'Kidney chromophobe': 'kidney chromophobe OR chromophobe renal cell carcinoma OR chromophobe kidney cancer',
  'Kidney renal clear cell carcinoma': 'kidney renal clear cell carcinoma OR clear cell renal cell carcinoma OR ccRCC OR kidney cancer OR renal cell carcinoma',
  'Kidney renal papillary cell carcinoma': 'kidney renal papillary cell carcinoma OR papillary renal cell carcinoma OR kidney cancer OR renal cell carcinoma',
  'Acute myeloid leukemia': 'acute myeloid leukemia OR AML OR acute myelogenous leukemia',
  'Brain lower grade glioma': 'brain lower grade glioma OR low grade glioma OR glioma',
  'Liver hepatocellular carcinoma': 'liver hepatocellular carcinoma OR hepatocellular carcinoma OR HCC OR liver cancer OR hepatic cancer',
  'Lung adenocarcinoma': 'lung adenocarcinoma OR lung cancer OR non-small cell lung cancer OR NSCLC',
  'Lung squamous cell carcinoma': 'lung squamous cell carcinoma OR squamous cell lung carcinoma OR lung cancer OR NSCLC',
  'Mesothelioma': 'mesothelioma OR malignant mesothelioma OR pleural mesothelioma',
  'Ovarian serous cystadenocarcinoma': 'ovarian serous cystadenocarcinoma OR ovarian cancer OR serous ovarian cancer OR ovarian carcinoma',
  'Pancreatic adenocarcinoma': 'pancreatic adenocarcinoma OR pancreatic cancer OR pancreas cancer OR pancreatic ductal adenocarcinoma OR PDAC',
  'Pheochromocytoma and paraganglioma': 'pheochromocytoma OR paraganglioma',
  'Prostate adenocarcinoma': 'prostate adenocarcinoma OR prostate cancer OR prostatic cancer OR prostate carcinoma',
  'Rectum adenocarcinoma': 'rectum adenocarcinoma OR rectal adenocarcinoma OR rectal cancer OR colorectal cancer OR colorectal carcinoma',
  'Sarcoma': 'sarcoma OR soft tissue sarcoma OR bone sarcoma',
  'Skin cutaneous melanoma': 'skin cutaneous melanoma OR cutaneous melanoma OR melanoma OR skin cancer',
  'Stomach adenocarcinoma': 'stomach adenocarcinoma OR gastric cancer OR gastric adenocarcinoma OR stomach cancer OR gastric carcinoma',
  'Testicular germ cell tumors': 'testicular germ cell tumors OR testicular germ cell tumour OR testicular cancer OR germ cell tumor',
  'Thyroid carcinoma': 'thyroid carcinoma OR thyroid cancer',
  'Thymoma': 'thymoma OR thymic carcinoma OR thymic epithelial tumor',
  'Uterine corpus endometrial carcinoma': 'uterine corpus endometrial carcinoma OR endometrial cancer OR endometrial carcinoma OR uterus cancer',
  'Uterine carcinosarcoma': 'uterine carcinosarcoma OR carcinosarcoma OR uterine cancer',
  'Uveal melanoma': 'uveal melanoma OR ocular melanoma OR eye melanoma',
};

// 返回可拼进 OpenAlex search 的括号 OR 布尔组;未知名称原样返回（无括号,语义不变）。
export function expandCancerType(name) {
  const group = CANCER_SYNONYMS[name] || '';
  if (group) return `(${group})`;
  return name || '';
}
