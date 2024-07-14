<div align="center">
<a href="https://frappehealth.com">
    <img src="https://raw.githubusercontent.com/frappe/healthcare/develop/healthcare/public/images/healthcare.svg" height="128" alt="Marley Health Logo">
  </a>
  <h2>Marley Health</h2>
  <p align="center">
    <p>Open source & easy-to-use hospital information system(HIS) for all healthcare organisations.</p>
  </p>

  [Marley Health](https://frappehealth.com/home)

 <div align="center" style="max-height: 40px;">
    <a href="https://frappecloud.com/marley/signup">
        <img src=".github/try-on-f-cloud-button.svg" height="40">
    </a>
 </div>

</div>

### Introduction

Marley Health enables the health domain in ERPNext and has various features that will help healthcare practitioners, clinics and hospitals to leverage the power of Frappe and ERPNext. It is built on Frappe, a full-stack, meta-data driven, web framework, and integrates seamlessly with ERPNext, the most agile ERP software. Marley Health helps to manage healthcare workflows efficiently and most of the design is based on HL7 FHIR (Fast Health Interoperability Resources).


### Key Features

![Key Features](https://raw.githubusercontent.com/frappe/health/develop/key-features.png)

Key feature sets include Patient management, Outpatient / Inpatient management, Clinical Procedures, Rehabilitation and Physiotherapy, Laboratory management etc. and supports configuring multiple Medical Code Standards. It allows mapping any healthcare facility as Service Units and specialities as Medical Departments.

By integrating with ERPNext, features of ERPNext can also be utilized to manage Pharmacy and supplies, Purchases, Human Resources, Accounts and Finance, Asset Management, Quality etc. Along with authentication and role based access permissions, RESTfullness, extensibility, responsiveness and other goodies, the framework also allows setting up Website, payment integration and Patient portal.


### Installation

Using bench, [install ERPNext](https://github.com/frappe/bench#installation) as mentioned here.

Once ERPNext is installed, add health app to your bench by running

```sh
$ bench get-app healthcare
```

After that, you can install health app on required site by running

```sh
$ bench --site demo.com install-app healthcare
```


### Documentation

Complete documentation for Marley Health is available at https://frappehealth.com/docs


### License

GNU GPL V3. See [license.txt](https://github.com/earthians/marley/blob/develop/license.txt) for more information.


### Credits

Marley Health module is developed & maintained by Earthians and community contributors.
